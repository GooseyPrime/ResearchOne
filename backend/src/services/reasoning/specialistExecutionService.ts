import { callRoleModel, SYSTEM_PROMPTS, type ModelCallResult, type ModelRole } from '../openrouter/openrouterService';
import type { CanonicalExecutionPlan, SpecialistExecutionStatus } from '../planning/executionPlan';
import type { ResearchBrief } from '../planning/researchBrief';
import type {
  CompetitorMapperOutput,
  DataAnalysisSpecialistOutput,
  DemandSignalOutput,
  FeasibilityArchitectOutput,
  MarketScoutOutput,
  QuantitativeQualityAuditorOutput,
  StoryVerifierOutput,
  TimelineReconstructorOutput,
  SpecialistAgentId,
} from './agentCapabilityRegistry';
import { normalizeDeterministicMetricChecks } from './deterministicQuant';
import { logger } from '../../utils/logger';

const SPECIALIST_TIMEOUT_MS = 90_000;
const MAX_EVIDENCE_CONTEXT_CHARS = 50_000;

/**
 * Prompt budgets for specialist calls (WO-AA Phase 5).
 *
 * Run 6c59b711 sent ~95,000 prompt tokens to EVERY specialist and burned
 * 1,282,705 tokens producing nothing. The cause was triple duplication: the
 * raw ~700-line research request was sent as `QUERY`, embedded again inside
 * the serialized `PLAN` (its `retrieval_queries` contained the whole prompt),
 * and a third time inside `RESEARCH_BRIEF` — all uncapped.
 *
 * Specialists are narrow extractors. They need the task and its constraints,
 * not the full authoring spec for the final deliverable (which the synthesizer
 * receives separately).
 */
const MAX_QUERY_CHARS = 12_000;
const MAX_PLAN_CHARS = 8_000;
const MAX_BRIEF_CHARS = 6_000;
/** Log a warning above this total user-content size so regressions surface in telemetry, not the bill. */
export const SPECIALIST_PROMPT_WARN_CHARS = 120_000;

function truncate(value: string, max: number, label: string): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n...[${label} truncated: ${value.length} chars total]`;
}

/**
 * Replace verbatim copies of the research request inside serialized JSON with a
 * back-reference. Plans and briefs routinely embed the full query, which is the
 * single largest source of prompt duplication.
 */
export function redactDuplicatedQuery(serialized: string, query: string): string {
  const needle = (query ?? '').trim();
  // Only worth doing for substantial queries; short ones are cheap and
  // replacing them risks mangling unrelated text.
  if (needle.length < 400) return serialized;

  let out = serialized.split(needle).join('[see QUERY above]');
  // Plans and briefs are JSON-serialized, so the embedded copy has escaped
  // newlines/quotes and never matches the raw text. Missing this made the
  // whole redaction a no-op in production, where it matters most.
  const escaped = JSON.stringify(needle).slice(1, -1);
  if (escaped !== needle) {
    out = out.split(escaped).join('[see QUERY above]');
  }
  return out;
}

/** Build the shared context block sent to every specialist, with budgets applied. */
export function buildSpecialistContext(input: {
  query: string;
  plan: unknown;
  researchBrief?: unknown;
  evidenceContext: string;
}): string {
  const query = (input.query ?? '').trim();
  const evidenceTruncated = input.evidenceContext.length > MAX_EVIDENCE_CONTEXT_CHARS;

  const planJson = redactDuplicatedQuery(JSON.stringify(input.plan ?? {}), query);
  const briefJson = input.researchBrief
    ? redactDuplicatedQuery(JSON.stringify(input.researchBrief), query)
    : '';

  return [
    `QUERY: ${truncate(query, MAX_QUERY_CHARS, 'query')}`,
    `PLAN: ${truncate(planJson, MAX_PLAN_CHARS, 'plan')}`,
    briefJson ? `RESEARCH_BRIEF: ${truncate(briefJson, MAX_BRIEF_CHARS, 'brief')}` : '',
    `EVIDENCE_CONTEXT: ${input.evidenceContext.slice(0, MAX_EVIDENCE_CONTEXT_CHARS)}${evidenceTruncated ? '\n...[truncated]' : ''}`,
  ]
    .filter(Boolean)
    .join('\n\n');
}

type SpecialistOutputMap = {
  market_scout: MarketScoutOutput;
  competitor_mapper: CompetitorMapperOutput;
  demand_signal_analyst: DemandSignalOutput;
  feasibility_architect: FeasibilityArchitectOutput;
  story_verifier: StoryVerifierOutput;
  timeline_reconstructor: TimelineReconstructorOutput;
  data_analysis_specialist: DataAnalysisSpecialistOutput;
  quantitative_quality_auditor: QuantitativeQualityAuditorOutput;
};

export interface SpecialistExecutionBundle {
  planned: SpecialistAgentId[];
  ran: SpecialistAgentId[];
  skipped: SpecialistAgentId[];
  statuses: Record<SpecialistAgentId, SpecialistExecutionStatus>;
  reasons: Partial<Record<SpecialistAgentId, string>>;
  outputs: Partial<SpecialistOutputMap>;
  modelCalls: ModelCallResult[];
  degradedCoverageReasons: string[];
}

function extractJson(agent: SpecialistAgentId, raw: string): unknown {
  try {
    const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const body = (fenced?.[1] ?? raw).trim();
    const obj = body.match(/\{[\s\S]*\}$/);
    return JSON.parse((obj?.[0] ?? body).trim());
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    throw new Error(`${agent} returned non-JSON output: ${detail}`);
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function isConfidenceBand(v: unknown): v is 'low' | 'medium' | 'high' {
  return v === 'low' || v === 'medium' || v === 'high';
}

function validateSpecialistOutput(agent: SpecialistAgentId, raw: unknown): boolean {
  if (!isRecord(raw)) return false;
  switch (agent) {
    case 'market_scout':
      return Array.isArray(raw.opportunities) && typeof raw.summary === 'string' && isConfidenceBand(raw.confidence);
    case 'competitor_mapper':
      return Array.isArray(raw.competitors) && typeof raw.gap_summary === 'string' && isConfidenceBand(raw.confidence);
    case 'demand_signal_analyst':
      return Array.isArray(raw.signals) && typeof raw.demand_summary === 'string' && isConfidenceBand(raw.confidence);
    case 'feasibility_architect':
      return typeof raw.feasibility_verdict === 'string' && Array.isArray(raw.risks) && Array.isArray(raw.buildable_paths);
    case 'story_verifier':
      return typeof raw.verdict === 'string' && Array.isArray(raw.corroborating) && Array.isArray(raw.contradicting);
    case 'timeline_reconstructor':
      return Array.isArray(raw.events) && Array.isArray(raw.gaps) && typeof raw.summary === 'string';
    case 'data_analysis_specialist':
      return Array.isArray(raw.metrics) && typeof raw.trend_summary === 'string' && isConfidenceBand(raw.confidence);
    case 'quantitative_quality_auditor':
      return Array.isArray(raw.checks) && typeof raw.risk_summary === 'string' && isConfidenceBand(raw.confidence);
    default:
      return false;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function formatFindingsForPrompt(bundle: SpecialistExecutionBundle): string {
  const lines: string[] = [];
  for (const id of bundle.ran) {
    const out = bundle.outputs[id];
    if (!out) continue;
    lines.push(`## ${id}`);
    lines.push(JSON.stringify(out, null, 2));
  }
  return lines.join('\n');
}

export async function runSpecialistExecution(input: {
  runId: string;
  query: string;
  plan: unknown;
  evidenceContext: string;
  executionPlan: CanonicalExecutionPlan;
  researchBrief?: ResearchBrief;
  engineVersion?: string;
  researchObjective?: import('./reasoningModelPolicy').ResearchObjective;
  allowFallbackByRole: Record<string, boolean>;
  byokApiKeyOverride?: string;
  onProgress?: (message: string) => Promise<void> | void;
  onCheckpoint?: (key: string, snapshot: Record<string, unknown>) => Promise<void> | void;
}): Promise<SpecialistExecutionBundle & { findingsForPrompt: string }> {
  const planned = [...input.executionPlan.specialistAgents];
  const bundle: SpecialistExecutionBundle = {
    planned,
    ran: [],
    skipped: [],
    statuses: Object.fromEntries(planned.map((id) => [id, 'planned'])) as Record<SpecialistAgentId, SpecialistExecutionStatus>,
    reasons: {},
    outputs: {},
    modelCalls: [],
    degradedCoverageReasons: [],
  };

  const context = buildSpecialistContext({
    query: input.query,
    plan: input.plan,
    researchBrief: input.researchBrief,
    evidenceContext: input.evidenceContext,
  });
  if (context.length > SPECIALIST_PROMPT_WARN_CHARS) {
    logger.warn(
      `[${input.runId}] Specialist context is ${context.length} chars ` +
      `(> ${SPECIALIST_PROMPT_WARN_CHARS}); this is sent to every specialist. ` +
      `Check for duplicated query/plan/brief content before it reaches the bill.`
    );
  }
  const claimed = new Set<SpecialistAgentId>();

  const executeOne = async (agent: SpecialistAgentId): Promise<void> => {
    if (
      claimed.has(agent) ||
      bundle.statuses[agent] === 'succeeded' ||
      bundle.statuses[agent] === 'failed' ||
      bundle.statuses[agent] === 'invalid_output'
    ) {
      bundle.reasons[agent] = bundle.reasons[agent] ?? 'duplicate_planned';
      return;
    }
    const preStatus = input.executionPlan.statuses?.[agent];
    if (preStatus === 'unavailable' || preStatus === 'skipped') {
      bundle.statuses[agent] = preStatus;
      bundle.skipped.push(agent);
      const reason = input.executionPlan.skipReasons[agent] ?? 'Unavailable in runtime.';
      bundle.reasons[agent] = reason;
      bundle.degradedCoverageReasons.push(`${agent}: ${reason}`);
      return;
    }
    claimed.add(agent);

    await input.onProgress?.(`Executing specialist: ${agent}`);
    const deps = input.executionPlan.dependsOn[agent] ?? [];
    const depPayload: Record<string, unknown> = {};
    for (const dep of deps) {
      if (Object.hasOwn(bundle.outputs, dep)) {
        depPayload[dep] = bundle.outputs[dep] as unknown;
      }
    }
    try {
      const result = await withTimeout(
        callRoleModel({
          role: agent as ModelRole,
          engineVersion: input.engineVersion,
          researchObjective: input.researchObjective,
          allowFallbackByRole: input.allowFallbackByRole,
          byokApiKeyOverride: input.byokApiKeyOverride,
          messages: [
            { role: 'system', content: SYSTEM_PROMPTS[agent as keyof typeof SYSTEM_PROMPTS] },
            {
              role: 'user',
              content: `${context}\n\nDEPENDENCY_OUTPUTS:\n${JSON.stringify(depPayload)}`,
            },
          ],
        }),
        SPECIALIST_TIMEOUT_MS,
        agent
      );
      bundle.modelCalls.push(result);
      const parsed = extractJson(agent, result.content);
      if (!validateSpecialistOutput(agent, parsed)) {
        bundle.statuses[agent] = 'invalid_output';
        bundle.skipped.push(agent);
        bundle.reasons[agent] = 'Model returned invalid structured output.';
        bundle.degradedCoverageReasons.push(`${agent}: invalid_output`);
        return;
      }
      if (agent === 'data_analysis_specialist' && isRecord(parsed) && Array.isArray(parsed.metrics)) {
        const normalized = normalizeDeterministicMetricChecks(
          (parsed.metrics as Array<{ metric?: unknown; value?: unknown }>)
            .map((item) => ({
              metric: typeof item.metric === 'string' ? item.metric : 'unknown',
              value: typeof item.value === 'string' ? item.value : '',
            }))
        );
        parsed.deterministic_checks = normalized.checks;
        parsed.deterministic_summary = normalized.summary;
      }
      bundle.outputs[agent] = parsed as never;
      bundle.statuses[agent] = 'succeeded';
      bundle.ran.push(agent);
      await input.onCheckpoint?.(`specialist_${agent}`, {
        status: 'succeeded',
        output: parsed,
      });
    } catch (err) {
      bundle.statuses[agent] = 'failed';
      bundle.skipped.push(agent);
      const reason = err instanceof Error ? err.message : String(err);
      bundle.reasons[agent] = reason;
      bundle.degradedCoverageReasons.push(`${agent}: ${reason}`);
      await input.onCheckpoint?.(`specialist_${agent}`, {
        status: 'failed',
        reason,
      });
    }
  };

  for (const group of input.executionPlan.executionGroups) {
    await Promise.all(group.map((agent) => executeOne(agent)));
  }

  return {
    ...bundle,
    findingsForPrompt: formatFindingsForPrompt(bundle),
  };
}
