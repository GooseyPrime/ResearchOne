import { query, queryOne, withTransaction } from '../../db/pool';
import axios, { AxiosError } from 'axios';
import {
  callRoleModel,
  SYSTEM_PROMPTS,
  buildVerifierPromptForIntent,
  ModelCallResult,
  NormalizedModelError,
  type ModelRole,
} from '../openrouter/openrouterService';
import { retrieveChunks, RetrievedChunk } from '../retrieval/retrievalService';
import { runDiscoveryOrchestrator } from '../discovery/discoveryOrchestrator';
import { extractAndPersistClaims } from './claimExtractor';
import { extractAndPersistContradictions } from './contradictionExtractor';
import { mapAndPersistCitations } from './citationMapper';
import { logger } from '../../utils/logger';
import { saveRunCheckpoint } from './checkpointService';
import { decideRunStateOnFailure } from './runStateMachine';
import { generateIterativeReport, ADJUDICATIVE_SECTION_INTENTS } from './reportGenerator';
import { config } from '../../config';
import { clearRunCancelled, isRunCancellationRequested, ResearchCancelledError } from '../researchCancellation';
import { markReportFinalizedRetention, markRunTerminalRetention } from '../retention/retentionService';
import type { PerRunModelOverrides } from '../runtimeModelStore';
import { APPROVED_REASONING_MODEL_ALLOWLIST, type ResearchObjective, isHfRepoModel } from './reasoningModelPolicy';
import { allowFallbackByRoleFromOverrides } from './v2FallbackResolution';
import { mergeOrchestratorHintsIntoFailureMeta } from '../../utils/researchFailureHints';
import { consumeHold, releaseHold } from '../billing/walletReservations';
import { incrementReportCount } from '../tier/tierService';
import type {
  ProgressCallback,
  ResearchJobData,
  ResearchJobResult,
  ResearchProgress,
  RunSummaryPayload,
} from './researchOrchestratorTypes';
import { classifyIntent } from '../planning/intentClassifier';
import { formatBriefForPrompt, type ResearchBrief } from '../planning/researchBrief';
import { generatePlan } from '../planning/planGenerator';
import {
  insertGateResearchPlan,
  parkRunAwaitingPlanConfirmation,
} from '../planning/planWriteService';
import { normalizeRetrievalQueries, normalizeRunOverrides } from './researchOrchestratorNormalize';
import { patchAgentExecutionsReportIdForRun, runScope } from '../telemetry';
import { aggregateAndPersistDossierStatistics } from '../telemetry/dossierStatisticsAggregator';
import {
  mergePlanPayloadWithCanonicalProfile,
  resolveOrchestrationProfileFromJob,
} from '../planning/orchestrationRuntime';
import { buildCanonicalExecutionPlan, type SpecialistExecutionStatus } from '../planning/executionPlan';
import {
  applyAdversarialTwinToSkepticMode,
  buildRunAddonPipelineEffects,
  resolveRunAddons,
} from './runAddons';
import {
  PIPELINE_STAGES,
  type OrchestrationProfileDefinition,
  shouldRunPipelineStage,
} from '../planning/orchestrationProfiles';
import { classifyRetrievedSources } from '../planning/sourceClassClassifier';
import type { SourceClassMap } from '../planning/wave53EpistemicPolicy';
import {
  aggregateSourceClassBreakdown,
  buildReasonerSystemPrompt,
  buildSkepticSystemPrompt,
  dominantSourceClassesFromBreakdown,
} from '../planning/wave53EpistemicPolicy';
import { formatSteelmanBlockForSkeptic, runSteelmanPass } from './steelmanService';
import type { PlanPayload } from '../planning/planTypes';
import { runSpecialistExecution } from './specialistExecutionService';
import {
  isSpecialistAgentId,
  selectAgentsForBrief,
  type SpecialistAgentId,
} from './agentCapabilityRegistry';
import { reportRunErrorToGitHub } from '../githubErrorReporter';
import {
  mapGateStatusToReportRowStatus,
  mapGateStatusToRunStatus,
  shouldRunPipelineBFromGateStatus,
  type ReportGateStatus,
} from './reportGateStatus';

export type {
  CreditChargeContext,
  ProgressCallback,
  ResearchJobData,
  ResearchJobResult,
  ResearchProgress,
  RunSummaryPayload,
} from './researchOrchestratorTypes';
export { isResearchJobParkedAtPlanGate } from './researchOrchestratorTypes';

async function assertNotCancelled(runId: string): Promise<void> {
  if (await isRunCancellationRequested(runId)) {
    throw new ResearchCancelledError();
  }
}

function orchestrationStubModelResult(role: ModelRole, content: string): ModelCallResult {
  return {
    content,
    model: 'skipped-by-profile',
    role,
    promptTokens: 0,
    completionTokens: 0,
    durationMs: 0,
    usedFallback: false,
    primaryModel: 'skipped-by-profile',
  };
}

function emptyDiscoverySummary(runId: string) {
  return {
    runId,
    discoveryEnabled: false,
    planDecision: false,
    planRationale: 'Discovery skipped by orchestration profile.',
    queriesExecuted: 0,
    candidatesFound: 0,
    candidatesSelected: 0,
    sourcesIngested: 0,
    sourcesSkipped: 0,
    sources: [] as unknown[],
    durationMs: 0,
  };
}

function stubReasoningFromRetriever(retrieverMarkdown: string): string {
  return `Reasoning stage skipped by orchestration profile. Retriever analysis follows.\n\n${retrieverMarkdown}`;
}

function parseSkepticSidebarJson(raw: string): Array<Record<string, unknown>> {
  try {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) return [];
    const parsed = JSON.parse(m[0]) as unknown;
    return Array.isArray(parsed)
      ? (parsed.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>>)
      : [];
  } catch {
    return [];
  }
}

interface SpecialistFinding {
  role: string;
  content: string;
  parsed: Record<string, unknown> | null;
  failed: boolean;
  errorHint?: string;
}

interface ResearchPlan {
  sub_questions: string[];
  retrieval_queries: string[];
  hypothesis?: string;
  falsification_criteria?: string[];
  investigation_angles: string[];
}

interface VerificationResult {
  passed: boolean;
  criteria: Array<{ criterion: string; status: 'PASS' | 'FAIL'; note: string }>;
  overall: string;
}

interface ResearchFailureDetails {
  errorMessage: string;
  failureMeta: Record<string, unknown>;
  retryable: boolean;
}
const RETRIEVAL_PROGRESS_BASE = 22;
const RETRIEVAL_PROGRESS_CAP = 34;

interface ReaderFrontMatter {
  overall_summary: string;
  conclusions_nutshell: string;
  metric_glosses: Array<{ label: string; narrative: string }>;
}

function runtimeOverrideForRole(
  overrides: PerRunModelOverrides,
  role: keyof typeof APPROVED_REASONING_MODEL_ALLOWLIST
): { primary?: string; fallback?: string } | undefined {
  const entry = overrides.overrides?.[role];
  if (!entry) return undefined;
  const primary = entry.primary?.trim() || undefined;
  const fallback = entry.fallback?.trim() || undefined;
  if (!primary && !fallback) return undefined;
  return { primary, fallback };
}

function snapshotModelEnsemble(overrides: PerRunModelOverrides): Record<string, unknown> {
  const roles = Object.keys(APPROVED_REASONING_MODEL_ALLOWLIST);
  const out: Record<string, unknown> = {};
  for (const role of roles) {
    const o = overrides.overrides?.[role];
    out[role] = {
      primary_override: o?.primary ?? null,
      fallback_override: o?.fallback ?? null,
      fallback_enabled: o?.fallbackEnabled === true,
    };
  }
  return out;
}

function buildReaderFrontMatter(args: {
  intentId: string;
  executiveSummary: string;
  conclusion: string;
  contradictionCount: number;
  sourceCount: number;
  chunkCount: number;
  falsificationCriteria: string[] | null | undefined;
  requestedOpportunityCount?: number;
  deliveredOpportunityCount?: number;
  fieldsCompleteCount?: number;
  constraintsPassed?: number;
  constraintsFailed?: number;
  usableSourceCount?: number;
  independentDomainCount?: number;
  validationExperimentCount?: number;
  contractStatus?: string;
}): ReaderFrontMatter {
  const summary = (args.executiveSummary ?? '').trim().replace(/\s+/g, ' ');
  const conclusion = (args.conclusion ?? '').trim().replace(/\s+/g, ' ');
  const falsificationCriteria = Array.isArray(args.falsificationCriteria)
    ? args.falsificationCriteria.filter((c) => typeof c === 'string')
    : [];

  const fallbackSummary = `This report synthesizes evidence from ${args.sourceCount} sources and ${args.chunkCount} evidence chunks to evaluate the core research question.`;
  const fallbackConclusion = args.contradictionCount > 0
    ? `The findings include ${args.contradictionCount} explicit contradiction points, meaning important claims conflict and require targeted follow-up validation.`
    : 'The current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage.';

  const nonAdjudicativeIntent = !ADJUDICATIVE_SECTION_INTENTS.has(args.intentId);
  const metricGlosses = nonAdjudicativeIntent
    ? [
        {
          label: 'Deliverable coverage',
          narrative:
            typeof args.requestedOpportunityCount === 'number' && typeof args.deliveredOpportunityCount === 'number'
              ? `Delivered ${args.deliveredOpportunityCount}/${args.requestedOpportunityCount} requested opportunities.`
              : 'Requested deliverable count tracking unavailable.',
        },
        {
          label: 'Field completeness',
          narrative:
            typeof args.fieldsCompleteCount === 'number'
              ? `${args.fieldsCompleteCount} artifacts passed required-field completeness checks.`
              : 'Required-field completeness not fully evaluated.',
        },
        {
          label: 'Constraint status',
          narrative:
            typeof args.constraintsPassed === 'number' && typeof args.constraintsFailed === 'number'
              ? `${args.constraintsPassed} user constraints were provided; ${args.constraintsFailed} unresolved contract requirements remained at finalize time.`
              : 'Constraint pass/fail tracking unavailable.',
        },
        {
          label: 'Evidence coverage',
          narrative:
            typeof args.usableSourceCount === 'number' && typeof args.independentDomainCount === 'number'
              ? `${args.usableSourceCount} usable sources across ${args.independentDomainCount} independent domains; ${args.chunkCount} evidence chunks reviewed.`
              : `${args.sourceCount} sources and ${args.chunkCount} chunks were reviewed; broader coverage can still change confidence.`,
        },
        {
          label: 'Validation experiments',
          narrative:
            typeof args.validationExperimentCount === 'number'
              ? `${args.validationExperimentCount} validation experiments were provided in the generated artifact.`
              : 'Validation-experiment coverage unavailable.',
        },
        {
          label: 'Contract status',
          narrative: args.contractStatus ?? 'Contract status unavailable.',
        },
      ]
    : [
        {
          label: 'Contradictions',
          narrative:
            args.contradictionCount > 0
              ? `${args.contradictionCount} claim conflicts were detected. Each conflict shows two evidence-backed statements that cannot both be true as currently framed.`
              : 'No explicit claim conflicts were detected in this run; this does not prove harmony, only that no direct contradiction pairs were extracted.',
        },
        {
          label: 'Counterevidence / Falsification',
          narrative:
            falsificationCriteria.length > 0
              ? `This report's conclusions would be falsified by: ${falsificationCriteria.slice(0, 2).join('; ')}.`
              : 'No specific falsification targets were extracted. Counterevidence would need to directly contradict the central mechanism or primary hypothesis stated in the report body.',
        },
        {
          label: 'Evidence coverage',
          narrative: `${args.sourceCount} sources and ${args.chunkCount} chunks were reviewed; broader coverage can still change the confidence profile of conclusions.`,
        },
      ];

  return {
    overall_summary: [summary.slice(0, 260) || fallbackSummary, conclusion.slice(0, 220) || fallbackConclusion]
      .filter(Boolean)
      .join(' '),
    conclusions_nutshell: conclusion.slice(0, 360) || fallbackConclusion,
    metric_glosses: metricGlosses,
  };
}

function buildExecutionResearchPlanFromConfirmedBrief(args: {
  query: string;
  brief?: ResearchBrief;
  supplemental?: string;
  isAdjudicative: boolean;
}): ResearchPlan {
  const baseQueries = new Set<string>([args.query]);
  const artifactQueries = (args.brief?.requestedArtifacts ?? [])
    .map((artifact) => artifact.description?.trim())
    .filter((value): value is string => Boolean(value));
  const constraintQueries = (args.brief?.userConstraints ?? [])
    .map((constraint) => constraint.description?.trim())
    .filter((value): value is string => Boolean(value));
  if (args.supplemental?.trim()) baseQueries.add(args.supplemental.trim());
  for (const query of artifactQueries) baseQueries.add(`${args.query} ${query}`);
  for (const query of constraintQueries) baseQueries.add(`${args.query} ${query}`);

  const retrievalQueries = normalizeRetrievalQueries(Array.from(baseQueries), args.query).slice(0, 12);
  const subQuestions = retrievalQueries.map((query, index) => `Q${index + 1}: ${query}`);
  const investigationAngles = [
    `Primary intent: ${args.brief?.primaryIntent ?? 'unknown'}`,
    ...(args.brief?.secondaryIntent ? [`Secondary intent: ${args.brief.secondaryIntent}`] : []),
    ...(artifactQueries.length > 0 ? ['Requested artifacts coverage'] : []),
    ...(constraintQueries.length > 0 ? ['User constraint compliance'] : []),
  ];

  return {
    sub_questions: subQuestions.length > 0 ? subQuestions : [args.query],
    retrieval_queries: retrievalQueries.length > 0 ? retrievalQueries : [args.query],
    ...(args.isAdjudicative && {
      hypothesis: args.query,
      falsification_criteria: [
        `Evidence directly contradicting the core claims or mechanism proposed in response to the query "${args.query.slice(0, 120)}" would disprove this report's conclusions.`,
      ],
    }),
    investigation_angles: investigationAngles.length > 0 ? investigationAngles : ['Main investigation'],
  };
}

function countIndependentDomains(chunks: RetrievedChunk[]): number {
  const domains = new Set<string>();
  for (const chunk of chunks) {
    const raw = chunk.source_url ?? '';
    if (!raw) continue;
    try {
      domains.add(new URL(raw).hostname.replace(/^www\./i, '').toLowerCase());
    } catch {
      // ignore malformed URLs
    }
  }
  return domains.size;
}

function parseOpportunityTitleLine(line: string): string | null {
  const trimmed = line.trim();
  const normalized = trimmed
    .replace(/^[-*+]\s+/, '')
    .replace(/^\*\*/, '')
    .replace(/\*\*$/, '')
    .trim();
  const numbered = normalized.match(/^#?\s*(\d+)[\.\):]\s+(.+)$/);
  if (numbered) return `Opportunity ${numbered[1]}: ${numbered[2].trim()}`;
  const named = normalized.match(/^opportunity\s*#?\s*(\d+)\s*[:\-–]\s*(.+)$/i);
  if (named) return `Opportunity ${named[1]}: ${named[2].trim()}`;
  return null;
}

function parseOpportunityRowsFromMarkdownTable(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && line.includes('|'));
  if (lines.length < 3) return [];

  const separatorRegex = /^\|?\s*:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)*\s*\|?$/;
  for (let i = 0; i < lines.length - 2; i += 1) {
    const headerLine = lines[i];
    const separatorLine = lines[i + 1];
    if (!separatorRegex.test(separatorLine)) continue;

    const headers = headerLine
      .split('|')
      .map((cell) => cell.trim())
      .filter(Boolean)
      .map((header) => header.toLowerCase());
    if (headers.length === 0) continue;

    const looksOpportunityTable = headers.some((header) =>
      /opportunity|title|idea|rank|problem|customer|confidence/.test(header)
    );
    if (!looksOpportunityTable) continue;

    const titleIndex = headers.findIndex((header) => /opportunity|title|idea|name/.test(header));
    const rankIndex = headers.findIndex((header) => /rank|#|order/.test(header));
    const out: Array<{ title: string; body: string }> = [];

    for (let rowIndex = i + 2; rowIndex < lines.length; rowIndex += 1) {
      const rowLine = lines[rowIndex];
      if (separatorRegex.test(rowLine)) continue;
      const values = rowLine
        .split('|')
        .map((cell) => cell.trim())
        .filter(Boolean);
      if (values.length === 0 || values.length < Math.min(headers.length, 2)) continue;
      const rankToken = rankIndex >= 0 ? values[rankIndex] : '';
      const titleToken = titleIndex >= 0 ? values[titleIndex] : values[Math.min(1, values.length - 1)];
      const isOpportunityRow =
        /^#?\d+$/.test(rankToken) || /^opportunity\s*#?\d+/i.test(titleToken) || Boolean(titleToken);
      if (!isOpportunityRow) continue;
      const title = /^opportunity/i.test(titleToken)
        ? titleToken
        : `${/^#?\d+$/.test(rankToken) ? `Opportunity ${rankToken}` : 'Opportunity'}: ${titleToken}`;
      const body = headers
        .map((header, idx) => `${header}: ${values[idx] ?? ''}`)
        .join('\n')
        .trim();
      out.push({ title: title.trim(), body });
    }

    if (out.length > 0) return out;
  }

  return [];
}

function extractOpportunityObjectsFromMarkdown(markdown: string): Array<{ title: string; body: string }> {
  const lines = markdown.split('\n');
  const out: Array<{ title: string; body: string }> = [];
  let current: { title: string; body: string[] } | null = null;
  for (const line of lines) {
    const header = line.match(/^#{1,4}\s+(.+)$/);
    const listTitle = parseOpportunityTitleLine(line) ?? (header ? parseOpportunityTitleLine(header[1] ?? '') : null);
    if (header || listTitle) {
      if (current) {
        out.push({ title: current.title, body: current.body.join('\n').trim() });
      }
      const title = listTitle ?? header?.[1]?.trim() ?? '';
      if (/^opportunity\s*#?\s*\d+/i.test(title)) {
        current = { title, body: [] };
      } else {
        current = null;
      }
      continue;
    }
    if (current) current.body.push(line);
  }
  if (current) {
    out.push({ title: current.title, body: current.body.join('\n').trim() });
  }
  if (out.length > 0) return out;
  return parseOpportunityRowsFromMarkdownTable(markdown);
}

function fieldCompletenessForOpportunities(opportunities: Array<{ title: string; body: string }>): number {
  const requiredMarkers = [
    'target customer',
    'problem',
    'demand',
    'competitor',
    'differentiation',
    'mvp',
    'stack',
    'monetization',
    'acquisition',
    'risk',
    'validation',
    'build prompt',
    'test prompt',
    'deployment prompt',
    'acceptance criteria',
    'confidence',
    'evidence',
  ];
  let complete = 0;
  for (const opportunity of opportunities) {
    const text = `${opportunity.title}\n${opportunity.body}`.toLowerCase();
    const missing = requiredMarkers.some((marker) => !text.includes(marker));
    if (!missing) complete += 1;
  }
  return complete;
}

function runDeterministicContractValidation(args: {
  intentId: string;
  markdown: string;
  brief: ResearchBrief;
}): {
  pass: boolean;
  missing: string[];
  revision: string[];
  metrics: Record<string, number>;
} {
  const missing: string[] = [];
  const revision: string[] = [];
  const metrics: Record<string, number> = {};
  if (args.intentId === 'opportunity_discovery') {
    const opportunities = extractOpportunityObjectsFromMarkdown(args.markdown);
    const requestedCount =
      args.brief.requestedArtifacts.find((artifact) => typeof artifact.exactCount === 'number')?.exactCount ?? null;
    const completeFields = fieldCompletenessForOpportunities(opportunities);
    metrics.opportunitiesDelivered = opportunities.length;
    metrics.opportunitiesWithAllRequiredFields = completeFields;
    if (typeof requestedCount === 'number') {
      metrics.opportunitiesRequested = requestedCount;
      if (opportunities.length !== requestedCount) {
        missing.push(`exact_count_mismatch:${opportunities.length}/${requestedCount}`);
        revision.push(`Deliver exactly ${requestedCount} opportunity objects with consistent ranking and headings.`);
      }
    }
    if (completeFields !== opportunities.length) {
      missing.push('required_fields_missing_in_opportunities');
      revision.push(
        'Each opportunity must include target customer, problem, demand evidence, competitors, differentiation, MVP scope, stack/services, monetization, acquisition, risks, validation experiment, evidence IDs, build/test/deploy prompts, acceptance criteria, and confidence.'
      );
    }
  }
  return {
    pass: missing.length === 0,
    missing,
    revision,
    metrics,
  };
}

async function appendRunProgressEvent(runId: string, event: Record<string, unknown>): Promise<void> {
  await query(
    `UPDATE research_runs
        SET progress_events = CASE
          WHEN jsonb_typeof(progress_events) = 'array'
            THEN (progress_events || $2::jsonb)
          ELSE $2::jsonb
        END
      WHERE id = $1`,
    [runId, JSON.stringify([event])]
  );
}

function v2CallOpts(
  engineVersion: string | undefined,
  researchObjective: ResearchObjective | undefined,
  allowFallbackByRole: Record<string, boolean>
) {
  return {
    engineVersion: engineVersion ?? undefined,
    researchObjective: researchObjective ?? undefined,
    allowFallbackByRole,
  };
}

function computeAgentExecutionTelemetry(args: {
  orchProfile: OrchestrationProfileDefinition;
  plannedSpecialists: readonly string[];
  specialistRan: readonly string[];
  specialistSkipped: readonly string[];
}) {
  const ran = Array.from(
    new Set([
      'planner',
      shouldRunPipelineStage(args.orchProfile, 'retriever_analysis') ? 'retriever' : null,
      shouldRunPipelineStage(args.orchProfile, 'reasoning') ? 'reasoner' : null,
      'synthesizer',
      shouldRunPipelineStage(args.orchProfile, 'verification') ? 'verifier' : null,
      ...args.specialistRan,
    ].filter((v): v is string => Boolean(v)))
  );
  // Use the profile's skipped stages directly, mapped to agent names rather than
  // stage IDs, so telemetry stays in agent-id space. Filtering agentsToRun by
  // !shouldRunPipelineStage would always yield empty because agentsToRun only
  // contains stages that pass that check.
  const skipped = Array.from(
    new Set([
      ...args.specialistSkipped,
      !shouldRunPipelineStage(args.orchProfile, 'retriever_analysis') ? 'retriever' : null,
      !shouldRunPipelineStage(args.orchProfile, 'reasoning') ? 'reasoner' : null,
      !shouldRunPipelineStage(args.orchProfile, 'verification') ? 'verifier' : null,
    ].filter((v): v is string => Boolean(v)))
  );
  const planned = Array.from(new Set(['planner', 'retriever', 'reasoner', 'synthesizer', 'verifier', ...args.plannedSpecialists]));
  return { planned, ran, skipped };
}

/**
 * Public entry point. Establishes the cost-telemetry run scope so all
 * nested `callRoleModel` calls (orchestrator, discovery, report
 * generator, extractors) emit `agent_executions` rows tagged with the
 * correct run / user / org. The inner function is `runResearchJobInner`
 * — do not call it directly.
 *
 * Per Rule 25 invariant I-2: only this function (plus the analogous
 * wrappers in discoveryOrchestrator, reportRevisionService) may call
 * `runScope.run`.
 */
export async function runResearchJob(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<ResearchJobResult> {
  return runScope.run(
    {
      runId: data.runId,
      userId: data.creditChargeContext?.userId ?? null,
      orgId: null,
      reportId: null,
    },
    () => runResearchJobInner(data, onProgress)
  );
}

async function runResearchJobInner(
  data: ResearchJobData,
  onProgress: ProgressCallback
): Promise<ResearchJobResult> {
  const {
    runId,
    query: researchQuery,
    supplemental,
    filterTags,
    modelOverrides: incomingModelOverrides,
    engineVersion,
    researchObjective,
    targetWordCount,
    citationStyle,
  } = data;
  const runModelOverrides = normalizeRunOverrides(incomingModelOverrides);
  const allowFallbackByRole = allowFallbackByRoleFromOverrides(runModelOverrides);
  const v2Base = v2CallOpts(engineVersion, researchObjective, allowFallbackByRole);
  const creditCtx = data.creditChargeContext;

  // BYOK: if user is on BYOK tier, all OpenRouter calls use their key.
  // Errors are fatal for BYOK runs (fail closed, never fall back to platform key).
  let byokApiKeyOverride: string | undefined;
  if (creditCtx?.type === 'byok' && creditCtx.userId) {
    const { getDecryptedKey } = await import('../byok/keyVault');
    const key = await getDecryptedKey(creditCtx.userId, 'openrouter');
    if (!key) {
      throw new Error('BYOK key required but not found. Configure your API key at /app/byok before running research.');
    }
    byokApiKeyOverride = key;
  }
  const v2 = { ...v2Base, ...(byokApiKeyOverride ? { byokApiKeyOverride } : {}) };

  const runAddons = await resolveRunAddons(runId, data.addons);
  const addonEffects = buildRunAddonPipelineEffects(runAddons);

  const resumeJobPayload: ResearchJobData = {
    runId,
    query: researchQuery,
    supplemental,
    filterTags,
    modelOverrides: runModelOverrides,
    engineVersion,
    researchObjective,
    targetWordCount,
    citationStyle,
    creditChargeContext: creditCtx,
    addons: runAddons.length > 0 ? [...runAddons] : undefined,
    savedOrchestrationProfileSeed: data.savedOrchestrationProfileSeed,
    confirmedPlanPayload: data.confirmedPlanPayload,
  };
  const modelLog: ModelCallResult[] = [];
  let currentStage = 'queued';
  let currentPercent = 0;
  let currentMessage = 'Queued';
  const runStartedAt = Date.now();
  const phaseStartTimes: Record<string, number> = {};
  const phaseDurations: Record<string, number> = {};
  const orchProfile = applyAdversarialTwinToSkepticMode(
    resolveOrchestrationProfileFromJob(data),
    runAddons
  );
  const confirmedResearchBrief = data.confirmedPlanPayload?.researchBrief;
  const sourceClassesFromPlan =
    data.confirmedPlanPayload?.sourceStrategy?.weightedClasses && Array.isArray(data.confirmedPlanPayload.sourceStrategy.weightedClasses)
      ? data.confirmedPlanPayload.sourceStrategy.weightedClasses
      : [];
  const canonicalExecutionPlan =
    data.confirmedPlanPayload?.executionPlan ??
    data.confirmedPlanPayload?.orchestrationProfile?.executionPlan ??
    buildCanonicalExecutionPlan({
      profile: orchProfile,
      researchBrief: confirmedResearchBrief,
      sourceClasses: sourceClassesFromPlan,
    });
  const specialistAgentIds = (() => {
    const fromPlan = data.confirmedPlanPayload?.orchestrationProfile?.agentsWillRun
      ?.filter((id): id is string => typeof id === 'string' && isSpecialistAgentId(id));
    if (fromPlan && fromPlan.length > 0) return Array.from(new Set(fromPlan));
    const fallbackIntentId = data.confirmedPlanPayload?.intent?.id;
    if (!fallbackIntentId) return [];
    return selectAgentsForBrief(
      fallbackIntentId,
      data.confirmedPlanPayload?.researchBrief?.secondaryIntent
    )
      .filter((agent) => agent.isSpecialist)
      .map((agent) => agent.id);
  })();

  let wave53SourceClassMap: SourceClassMap = { byChunkId: new Map(), bySourceUrl: new Map() };
  let wave53SourceClassBreakdown: Record<string, number> = {};
  let wave53SteelmanPassCount = 0;
  let wave53SteelmanByClaimKey = new Map<string, string>();
  let specialistFindingsBlock = '';
  let specialistStatuses: Partial<Record<SpecialistAgentId, SpecialistExecutionStatus>> = canonicalExecutionPlan.statuses ?? {};
  let specialistSkipped: string[] = [];
  let degradedCoverageReasons: string[] = [];
  let specialistRan: string[] = [];

  const progress = async (
    stage: string,
    percent: number,
    message: string,
    extra?: Omit<ResearchProgress, 'stage' | 'percent' | 'message' | 'runId' | 'timestamp'>
  ) => {
    await assertNotCancelled(runId);
    // Phase timing: close out the previous phase and open the incoming one.
    // We always reset phaseStartTimes[stage]=now on every call so that
    // resume/retry re-entries start a fresh window instead of double-counting
    // the gap spent in other stages (Copilot review finding).
    const now = Date.now();
    if (currentStage && currentStage !== stage) {
      const phaseStart = phaseStartTimes[currentStage];
      if (phaseStart != null) {
        phaseDurations[currentStage] = (phaseDurations[currentStage] ?? 0) + (now - phaseStart);
        delete phaseStartTimes[currentStage];
      }
    }
    phaseStartTimes[stage] = now;
    currentStage = stage;
    currentPercent = percent;
    currentMessage = message;
    const payload = {
      stage,
      percent,
      message,
      runId,
      timestamp: new Date().toISOString(),
      ...extra,
      profileDisplayName: orchProfile.displayName,
    };
    onProgress(payload);
    logger.info(`[${runId}] ${stage}: ${message}`);
    try {
      await query(
        `UPDATE research_runs SET progress_stage=$1, progress_percent=$2, progress_message=$3, progress_updated_at=NOW() WHERE id=$4`,
        [stage, Math.round(percent), message.slice(0, 2000), runId]
      );
      await appendRunProgressEvent(runId, payload);
    } catch (e) {
      logger.warn(`[${runId}] progress persist skipped`, e);
    }
  };

  // Mark run as running.
  //
  // We also reset progress_stage / progress_percent / progress_message to a
  // clean "starting" snapshot. This matters for application-level
  // retry-from-failure attempts: without this, a retried run would inherit the
  // last failed attempt's stale progress (e.g. 'discovery 15%') for several
  // seconds before the orchestrator's first `progress(...)` call, which is
  // exactly the "still says running but nothing is happening" symptom the HAR
  // captured on 2026-04-26. We also clear failed_stage/error_message/failure_meta
  // for the new attempt so the live trace tells a coherent story.
  await query(
    `UPDATE research_runs
        SET status='running',
            started_at=COALESCE(started_at, NOW()),
            error_message=NULL,
            failed_stage=NULL,
            failure_meta='{}'::jsonb,
            progress_stage='starting',
            progress_percent=1,
            progress_message='Worker picked up the run; preparing planner...',
            progress_updated_at=NOW(),
            model_overrides=$2::jsonb,
            model_ensemble=$3::jsonb
      WHERE id=$1`,
    [runId, JSON.stringify(runModelOverrides), JSON.stringify(snapshotModelEnsemble(runModelOverrides))]
  );

  await appendRunProgressEvent(runId, {
    runId,
    stage: 'starting',
    percent: 1,
    message: 'Worker picked up the run; preparing planner...',
    timestamp: new Date().toISOString(),
    eventType: 'progress',
    substep: 'worker_started',
  });

  try {
    // ────────────────────────────────────────────────────────────────
    // Wave 5.1 — Stage 0.5: intent classification + user-facing plan gate
    // (skipped on resume-after-confirm; `skipPlanConfirmationGate` is set
    // on the JSON payload stored by `parkRunAwaitingPlanConfirmation`).
    // ────────────────────────────────────────────────────────────────
    if (!data.skipPlanConfirmationGate) {
      try {
        await progress('plan_generation', 2, 'Detecting intent and generating plan...', {
          substep: 'plan_started',
        });

        const intentResult = await classifyIntent(researchQuery, supplemental, {
          engineVersion: engineVersion ?? undefined,
          researchObjective: researchObjective ?? undefined,
          allowFallbackByRole,
          byokApiKeyOverride,
        });

        const planPayload = await generatePlan({
          query: researchQuery,
          supplementalContext: supplemental,
          intent: intentResult.primaryIntent,
          intentConfidence: intentResult.confidence,
          researchBrief: intentResult,
          savedProfile: data.savedOrchestrationProfileSeed,
          llmOpts: {
            engineVersion: engineVersion ?? undefined,
            researchObjective: researchObjective ?? undefined,
            allowFallbackByRole,
            byokApiKeyOverride,
          },
        });

        const runScopeRow = await queryOne<{ user_id: string | null; org_id: string | null }>(
          `SELECT user_id, org_id FROM research_runs WHERE id = $1`,
          [runId]
        );

        const { planId } = await insertGateResearchPlan({
          runId,
          orgId: runScopeRow?.org_id ?? null,
          userId: runScopeRow?.user_id ?? null,
          intent: intentResult.primaryIntent,
          intentConfidence: intentResult.confidence,
          planPayload,
          orchestrationProfile: planPayload.orchestrationProfile?.name ?? null,
        });

        await progress('plan_pending_confirmation', 4, 'Plan ready — awaiting your confirmation', {
          substep: 'plan_ready',
          planId,
          intent: planPayload.intent.id,
          confidence: planPayload.intent.confidence,
        });

        await parkRunAwaitingPlanConfirmation(runId, resumeJobPayload);

        return {
          outcome: 'parked_at_plan_gate',
          runId,
          planId,
          planPayload,
          refinementRounds: 0,
        };
      } catch (gateErr) {
        const code = (gateErr as { code?: string })?.code;
        if (code === '42P01' || code === '42703' || code === '22P02') {
          logger.warn(`[${runId}] plan gate skipped (deploy skew / missing tables / enum)`, gateErr);
        } else {
          throw gateErr;
        }
      }
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 1: EXECUTION QUERY STRATEGY — preserve confirmed contract
    // ────────────────────────────────────────────────────────────────
    await progress('planning', 5, 'Building execution query strategy from confirmed plan...', {
      substep: 'request_started',
    });

    let plan: ResearchPlan;
    const isAdjudicative =
      orchProfile.intent == null || ADJUDICATIVE_SECTION_INTENTS.has(orchProfile.intent);
    if (confirmedResearchBrief) {
      plan = buildExecutionResearchPlanFromConfirmedBrief({
        query: researchQuery,
        brief: confirmedResearchBrief,
        supplemental,
        isAdjudicative,
      });
    } else {
      const plannerResult = await callRoleModel({
        role: 'planner',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'planner'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.planner },
          {
            role: 'user',
            content: `Research Query: ${researchQuery}\n\n${supplemental ? `Supplemental Context:\n${supplemental}\n\n` : ''}Produce a structured JSON research plan.`,
          },
        ],
      });
      modelLog.push(plannerResult);
      try {
        const jsonMatch = plannerResult.content.match(/\{[\s\S]*\}/);
        plan = JSON.parse(jsonMatch?.[0] ?? plannerResult.content) as ResearchPlan;
      } catch {
        plan = buildExecutionResearchPlanFromConfirmedBrief({
          query: researchQuery,
          supplemental,
          isAdjudicative,
        });
      }
      await progress('planning', 8, 'Planner response parsed', {
        substep: 'response_parsed',
        model: plannerResult.model,
        tokenUsage: { prompt: plannerResult.promptTokens, completion: plannerResult.completionTokens },
      });
    }
    // Defensive normalization: a planner that returns valid JSON but omits one
    // of these array fields used to crash at the saving stage with
    // "Cannot read properties of undefined (reading 'length')" — see PR #50.
    // Coerce every required field into the expected shape with safe fallbacks
    // so downstream readers (saveReport, buildReaderFrontMatter, prompts)
    // never see undefined.
    plan.retrieval_queries = normalizeRetrievalQueries(plan.retrieval_queries, researchQuery);
    plan.sub_questions = Array.isArray(plan.sub_questions) && plan.sub_questions.length > 0
      ? plan.sub_questions.map((q) => String(q))
      : [researchQuery];
    // hypothesis and falsification_criteria are only required for adjudicative
    // intents — descriptive/discovery intents omit them intentionally.
    if (isAdjudicative) {
      plan.falsification_criteria = Array.isArray(plan.falsification_criteria) && plan.falsification_criteria.length > 0
        ? plan.falsification_criteria.map((c) => String(c))
        : [`Evidence directly contradicting the core claims or mechanism proposed in response to the query "${researchQuery.slice(0, 120)}" would disprove this report's conclusions.`];
      if (typeof plan.hypothesis !== 'string' || !plan.hypothesis.trim()) {
        plan.hypothesis = researchQuery;
      }
    }
    plan.investigation_angles = Array.isArray(plan.investigation_angles) && plan.investigation_angles.length > 0
      ? plan.investigation_angles.map((a) => String(a))
      : ['Main investigation'];

    await query(
      `UPDATE research_runs SET plan=$1 WHERE id=$2`,
      [JSON.stringify(plan), runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'planning',
      checkpointKey: 'plan',
      snapshot: { plan },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 2: DISCOVERY — autonomous external research if needed
    // ────────────────────────────────────────────────────────────────
    let discoverySummary: Awaited<ReturnType<typeof runDiscoveryOrchestrator>>;
    if (shouldRunPipelineStage(orchProfile, 'discovery')) {
      await progress('discovery', 12, 'Discovery round 1: planning external queries...', { substep: 'queries_generating' });

      discoverySummary = await runDiscoveryOrchestrator({
        runId,
        researchQuery,
        plan: plan as unknown as Record<string, unknown>,
        filterTags,
        engineVersion,
        researchObjective,
        allowFallbackByRole,
        byokApiKeyOverride,
        userId: creditCtx?.userId,
        specialistAgentIds,
        maxIngestCapOverride: addonEffects.maxIngestCapOverride,
        minUsableSources: data.confirmedPlanPayload?.sourceStrategy?.expectedSourceCount?.min,
        maxCoverageRounds:
          data.confirmedPlanPayload?.researchBrief?.epistemicPosture === 'causal_test' ? 6 : 4,
        onRoundComplete: async ({ round, candidatesAfter }) => {
          const pct = round === 1 ? 15 : 17;
          await progress('discovery', pct, `Discovery round ${round} complete (${candidatesAfter} candidates after dedup)`, {
            substep: `discovery_round_${round}_complete`,
          });
        },
      });
    } else {
      await progress('discovery', 12, 'Discovery skipped for this intent profile', { substep: 'stage_skipped' });
      discoverySummary = emptyDiscoverySummary(runId) as unknown as Awaited<ReturnType<typeof runDiscoveryOrchestrator>>;
    }

    await query(
      `UPDATE research_runs SET discovery_summary=$1 WHERE id=$2`,
      [JSON.stringify(discoverySummary), runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'discovery',
      checkpointKey: 'discovery_summary',
      snapshot: { discoverySummary },
    });

    logger.info(`[${runId}] Discovery: ingested=${discoverySummary.sourcesIngested}, skipped=${discoverySummary.sourcesSkipped}`);

    // ────────────────────────────────────────────────────────────────
    // STAGE 3: RETRIEVAL — gather evidence (now includes discovery sources)
    // ────────────────────────────────────────────────────────────────
    const allChunks: RetrievedChunk[] = [];
    if (shouldRunPipelineStage(orchProfile, 'retrieval')) {
      await progress('retrieval', 20, 'Retrieving evidence from corpus...', { substep: 'retrieval_started' });

      const seenIds = new Set<string>();

      for (const rq of plan.retrieval_queries.slice(0, 5)) {
        const rqStr = typeof rq === 'string' ? rq : JSON.stringify(rq);
        const chunks = await retrieveChunks({
          query: rqStr,
          topK: addonEffects.retrievalTopK,
          filterTags,
          hybridSearch: true,
        });
        for (const c of chunks) {
          if (!seenIds.has(c.id)) {
            seenIds.add(c.id);
            allChunks.push(c);
          }
        }
        await progress('retrieval', Math.min(RETRIEVAL_PROGRESS_CAP, RETRIEVAL_PROGRESS_BASE + allChunks.length), `Retrieval query complete: ${rqStr}`, {
          substep: 'query_done',
          chunkCount: allChunks.length,
        });
      }
    } else {
      await progress('retrieval', 20, 'Retrieval skipped for this intent profile', { substep: 'stage_skipped' });
    }

    logger.info(`[${runId}] Retrieved ${allChunks.length} unique chunks`);
    const retrievalIds = allChunks.map(c => c.id);

    await query(
      `UPDATE research_runs SET retrieval_ids=$1 WHERE id=$2`,
      [retrievalIds, runId]
    );
    await saveRunCheckpoint({
      runId,
      stage: 'retrieval',
      checkpointKey: 'retrieval_ids',
      snapshot: { retrievalIds, chunkCount: allChunks.length },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 4: RETRIEVER ANALYSIS — evaluate evidence quality
    // ────────────────────────────────────────────────────────────────
    const evidenceContext = formatEvidenceContext(allChunks);

    let retrieverResult: ModelCallResult;
    if (shouldRunPipelineStage(orchProfile, 'retriever_analysis')) {
      await progress('retriever_analysis', 35, 'Analyzing retrieved evidence...', {
        substep: 'analysis_started',
        chunkCount: allChunks.length,
        sourceCount: new Set(allChunks.map((c) => c.source_url)).size,
      });

      retrieverResult = await callRoleModel({
        role: 'retriever',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'retriever'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.retriever },
          {
            role: 'user',
            content: `Research Query: ${researchQuery}\n\nPlan:\n${JSON.stringify(plan, null, 2)}\n\nRetrieved Evidence:\n${evidenceContext}\n\nAnalyze this evidence. Identify high-value chunks, outliers, contradictions, and bridge passages.`,
          },
        ],
      });
      modelLog.push(retrieverResult);
      await saveRunCheckpoint({
        runId,
        stage: 'retriever_analysis',
        checkpointKey: 'retriever_analysis',
        snapshot: { output: retrieverResult.content },
      });

      wave53SourceClassMap = await classifyRetrievedSources({
        chunks: allChunks,
        researchQuery,
        retrieverAnalysis: retrieverResult.content,
        ...v2,
      });
      wave53SourceClassBreakdown = aggregateSourceClassBreakdown(wave53SourceClassMap.byChunkId);
    } else {
      await progress('retriever_analysis', 35, 'Retriever analysis skipped for this intent profile', {
        substep: 'stage_skipped',
        chunkCount: allChunks.length,
      });
      retrieverResult = orchestrationStubModelResult('retriever', 'Retriever analysis skipped by orchestration profile.');
    }

    if (canonicalExecutionPlan.specialistAgents.length > 0) {
      await progress('reasoning', 42, 'Executing specialist analysis team...', {
        substep: 'specialist_started',
      });
      const specialistExecution = await runSpecialistExecution({
        runId,
        query: researchQuery,
        plan,
        evidenceContext,
        executionPlan: canonicalExecutionPlan,
        researchBrief: confirmedResearchBrief,
        engineVersion: v2.engineVersion,
        researchObjective: v2.researchObjective,
        allowFallbackByRole: v2.allowFallbackByRole,
        byokApiKeyOverride,
        onProgress: async (message) => {
          await progress('reasoning', 45, message, { substep: 'specialist_running' });
        },
        onCheckpoint: async (key, snapshot) => {
          await saveRunCheckpoint({
            runId,
            stage: 'reasoning',
            checkpointKey: key,
            snapshot,
          });
        },
      });
      modelLog.push(...specialistExecution.modelCalls);
      specialistStatuses = { ...specialistExecution.statuses };
      specialistSkipped = [...specialistExecution.skipped];
      specialistRan = [...specialistExecution.ran];
      degradedCoverageReasons = [...specialistExecution.degradedCoverageReasons];
      if (specialistExecution.findingsForPrompt.trim()) {
        specialistFindingsBlock = `SPECIALIST_FINDINGS (analysis only; not independent evidence):\n${specialistExecution.findingsForPrompt}`;
      }
      await progress('reasoning', 47, 'Specialist analysis completed.', {
        substep: 'specialist_done',
      });
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 5: REASONER — build structured arguments
    // ────────────────────────────────────────────────────────────────
    let reasonerResult: ModelCallResult;
    if (shouldRunPipelineStage(orchProfile, 'reasoning')) {
      await progress('reasoning', 50, 'Reasoning across sources...', { substep: 'reasoner_started' });
      const specialistPromptBlock = specialistFindingsBlock ? `\n\n${specialistFindingsBlock}` : '';
      const reasonerUserPrompt = [
        `Research Query: ${researchQuery}`,
        `Plan:\n${JSON.stringify(plan, null, 2)}`,
        `Evidence Analysis:\n${retrieverResult.content}`,
        `Evidence Chunks:\n${evidenceContext}`,
        specialistPromptBlock,
        'INSTRUCTION:\nBuild detailed reasoning chains. Tag every claim with evidence tier.',
      ].filter(Boolean).join('\n\n');

      reasonerResult = await callRoleModel({
        role: 'reasoner',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'reasoner'),
        messages: [
          { role: 'system', content: buildReasonerSystemPrompt() },
          {
            role: 'user',
            content: reasonerUserPrompt,
          },
        ],
      });
      modelLog.push(reasonerResult);
      await saveRunCheckpoint({
        runId,
        stage: 'reasoning',
        checkpointKey: 'reasoner_output',
        snapshot: { output: reasonerResult.content },
      });
    } else {
      await progress('reasoning', 50, 'Reasoning skipped for this intent profile', { substep: 'stage_skipped' });
      reasonerResult = orchestrationStubModelResult('reasoner', stubReasoningFromRetriever(retrieverResult.content));
    }

    const specialistFindings: SpecialistFinding[] = [];

    // Wave 5.3 — steelman pass (feeds skeptic user message + claim persistence)
    if (orchProfile.steelmanMode !== 'off') {
      await progress('reasoning', 62, 'Steelman pass: strengthening formulations before critique...', {
        substep: 'steelman_started',
      });
      const steel = await runSteelmanPass({
        reasonerOutput: reasonerResult.content,
        chunks: allChunks,
        steelmanMode: orchProfile.steelmanMode,
        sourceClassMap: wave53SourceClassMap,
        ...v2,
      });
      wave53SteelmanByClaimKey = steel.steelmanByClaimKey;
      wave53SteelmanPassCount = steel.passCount;
      if (steel.modelResult) modelLog.push(steel.modelResult);
    }

    const wave53DominantSourceClasses = dominantSourceClassesFromBreakdown(wave53SourceClassBreakdown);
    const skepticSystemPrompt = buildSkepticSystemPrompt(wave53DominantSourceClasses);
    const wave53SteelmanUserBlock = formatSteelmanBlockForSkeptic(wave53SteelmanByClaimKey);

    // ────────────────────────────────────────────────────────────────
    // STAGE 6: SKEPTIC — challenge conclusions (off | gate | annotate)
    // ────────────────────────────────────────────────────────────────
    let skepticResult: ModelCallResult;
    const skepticAnnotations: Array<Record<string, unknown>> = [];
    const skepticRuns =
      shouldRunPipelineStage(orchProfile, 'challenge') && orchProfile.skepticMode !== 'off';

    if (!skepticRuns) {
      await progress('challenge', 65, 'Skeptic skipped for this intent profile', { substep: 'stage_skipped' });
      skepticResult = orchestrationStubModelResult('skeptic', '');
    } else if (orchProfile.skepticMode === 'annotate') {
      await progress('challenge', 65, 'Collecting skeptical annotations (sidebar)...', { substep: 'skeptic_annotate' });
      skepticResult = await callRoleModel({
        role: 'skeptic',
        ...v2,
        callPurpose: 'pipeline_skeptic',
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'skeptic'),
        messages: [
          { role: 'system', content: skepticSystemPrompt },
          {
            role: 'user',
            content:
              `Return ONLY a JSON array (no markdown, no prose outside the array) of objects with keys ` +
              `"topic", "critique", "suggested_checks". Each object is one sidebar note for reviewers. ` +
              `Base them on the reasoning below; do not duplicate the main report narrative.\n\n` +
              `Research Query: ${researchQuery}\n\nReasoning:\n${reasonerResult.content}` +
              wave53SteelmanUserBlock,
          },
        ],
      });
      modelLog.push(skepticResult);
      skepticAnnotations.push(...parseSkepticSidebarJson(skepticResult.content));
      await saveRunCheckpoint({
        runId,
        stage: 'challenge',
        checkpointKey: 'skeptic_output',
        snapshot: { output: skepticResult.content, annotate: true },
      });
    } else {
      await progress('challenge', 65, 'Challenging conclusions with skeptic...', { substep: 'skeptic_started' });

      skepticResult = await callRoleModel({
        role: 'skeptic',
        ...v2,
        callPurpose: 'pipeline_skeptic',
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'skeptic'),
        messages: [
          { role: 'system', content: skepticSystemPrompt },
          {
            role: 'user',
            content:
              `Research Query: ${researchQuery}\n\nReasoning Produced:\n${reasonerResult.content}` +
              `${wave53SteelmanUserBlock}\n\nChallenge these conclusions (attack the steelman where provided; do not argue against a weaker strawman). Find weaknesses, alternatives, and counterevidence.`,
          },
        ],
      });
      modelLog.push(skepticResult);
      await saveRunCheckpoint({
        runId,
        stage: 'challenge',
        checkpointKey: 'skeptic_output',
        snapshot: { output: skepticResult.content },
      });
    }

    const challengesForSynthesis =
      orchProfile.skepticMode === 'annotate'
        ? 'Skeptical cross-checks were captured as structured sidebar annotations and are not inlined in this narrative.'
        : skepticResult.content;

    // ────────────────────────────────────────────────────────────────
    // STAGE 7: SYNTHESIZER — write the full report
    // ────────────────────────────────────────────────────────────────
    const outputTemplateId =
      (data.confirmedPlanPayload?.orchestrationProfile?.outputTemplateId as string | undefined) ??
      orchProfile.outputTemplateId;
    let generatedReport: { markdown: string };
    if (shouldRunPipelineStage(orchProfile, 'synthesis')) {
      await progress('synthesis', 80, 'Generating iterative report sections...', { substep: 'outline_started' });

      generatedReport = await generateIterativeReport({
        query: researchQuery,
        plan,
        evidenceContext,
        retrieverAnalysis: retrieverResult.content,
        reasoningChains: reasonerResult.content,
        challenges: challengesForSynthesis,
        specialistFindings: specialistFindingsBlock,
        engineVersion: v2.engineVersion,
        researchObjective: v2.researchObjective,
        allowFallbackByRole: v2.allowFallbackByRole,
        byokApiKeyOverride,
        targetWordCount,
        intentId: orchProfile.intent,
        outputTemplateId,
        onSectionProgress: async ({ title, index, total }) => {
          await progress('synthesis', Math.min(90, 80 + Math.floor((index / total) * 10)), `Report section ${index}/${total}: ${title}`, {
            substep: 'section_generated',
            detail: title,
          });
          await saveRunCheckpoint({
            runId,
            stage: 'synthesis',
            checkpointKey: `section_${index}`,
            snapshot: { sectionTitle: title, index, total },
          });
        },
      });
    } else {
      await progress('synthesis', 80, 'Minimal synthesis path (intent profile)...', { substep: 'synthesis_light' });
      const refSynth = await callRoleModel({
        role: 'synthesizer',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'synthesizer'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.synthesizer },
          {
            role: 'user',
            content:
              `Produce a concise markdown dossier for a reference lookup. Use these headings in order:\n` +
              `# Executive Summary\n(direct answer)\n# Evidence\n(short bullets tied to chunk IDs where possible)\n` +
              `# Source\n(primary URL or title)\n# Confidence\n(qualitative)\n\n` +
              `Research query:\n${researchQuery}\n\nRetriever analysis:\n${retrieverResult.content}\n\n` +
              `${specialistFindingsBlock ? `Specialist findings:\n${specialistFindingsBlock}\n\n` : ''}` +
              `Evidence:\n${evidenceContext.slice(0, 60000)}`,
          },
        ],
      });
      modelLog.push(refSynth);
      generatedReport = { markdown: refSynth.content.trim() };
      await saveRunCheckpoint({
        runId,
        stage: 'synthesis',
        checkpointKey: 'synthesis_light',
        snapshot: { mode: 'reference_lookup' },
      });
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 8: VERIFIER — epistemic quality gate (intent-specific rubric)
    // ────────────────────────────────────────────────────────────────
    let verifierResult: ModelCallResult;
    let verification: VerificationResult = { passed: false, criteria: [], overall: 'UNKNOWN' };
    let verificationUnavailable = false;
    if (shouldRunPipelineStage(orchProfile, 'verification')) {
      await progress('verification', 92, 'Verifying epistemic standards...');

      // Phase B — use per-intent verifier rubric instead of the universal prompt
      const intentVerifierPrompt = buildVerifierPromptForIntent(orchProfile.intent);

      verifierResult = await callRoleModel({
        role: 'verifier',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'verifier'),
        messages: [
          { role: 'system', content: intentVerifierPrompt },
          {
            role: 'user',
            content: `Verify this research report meets epistemic standards:\n\n${generatedReport.markdown}`,
          },
        ],
      });
      modelLog.push(verifierResult);

      try {
        const jsonMatch = verifierResult.content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          verification = JSON.parse(jsonMatch[0]) as VerificationResult;
          if (verification.overall !== 'PASS') {
            verification.passed = false;
          }
        } else {
          verificationUnavailable = true;
        }
      } catch {
        verificationUnavailable = true;
      }
    } else {
      await progress('verification', 92, 'Verification skipped for this intent profile', { substep: 'stage_skipped' });
      verifierResult = orchestrationStubModelResult(
        'verifier',
        JSON.stringify({ passed: false, criteria: [], overall: 'SKIPPED' }),
      );
      verificationUnavailable = true;
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 8c: CONTRACT AUDITOR — deliverable contract gate (Phase B)
    //
    // Compares the generated report against the ResearchBrief to detect
    // missing artifacts, unmet exact counts, ignored constraints, and
    // intent drift. Failures are logged and surfaced as metadata; they
    // do not abort the run (pipeline resilience per Rule 11).
    // ────────────────────────────────────────────────────────────────
    const researchBrief = confirmedResearchBrief ?? null;
    type ContractAuditResult = {
      pass: boolean;
      missing_requirements: string[];
      unsupported_claims: string[];
      intent_drift: string | null;
      revision_instructions: string[];
      status?: 'pass' | 'fail' | 'audit_unavailable';
      deterministic_metrics?: Record<string, number>;
    };
    let contractAuditResult: ContractAuditResult | null = null;
    const runContractAudit = async (markdown: string): Promise<void> => {
      if (!researchBrief || (researchBrief.requestedArtifacts.length === 0 && researchBrief.userConstraints.length === 0)) {
        contractAuditResult = null;
        return;
      }

      const deterministic = runDeterministicContractValidation({
        intentId: orchProfile.intent,
        markdown,
        brief: researchBrief,
      });
      contractAuditResult = {
        pass: deterministic.pass,
        missing_requirements: deterministic.missing,
        unsupported_claims: [],
        intent_drift: null,
        revision_instructions: deterministic.revision,
        status: deterministic.pass ? 'pass' : 'fail',
        deterministic_metrics: deterministic.metrics,
      };
      try {
        await progress('verification', 93, 'Auditing deliverable contract...');
        const auditUserContent = [
          `RESEARCH_BRIEF:\n${formatBriefForPrompt(researchBrief)}`,
          `\nGENERATED_REPORT:\n${markdown.slice(0, 60000)}`,
        ].join('\n');

        const auditModelResult = await callRoleModel({
          role: 'contract_auditor',
          callPurpose: 'phase_b_contract_audit',
          ...v2,
          runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'contract_auditor'),
          messages: [
            { role: 'system', content: SYSTEM_PROMPTS.contract_auditor },
            { role: 'user', content: auditUserContent },
          ],
        });
        modelLog.push(auditModelResult);

        try {
          const jsonMatch = auditModelResult.content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const llmAudit = JSON.parse(jsonMatch[0]) as ContractAuditResult;
            contractAuditResult = {
              pass: Boolean(contractAuditResult?.pass) && Boolean(llmAudit.pass),
              missing_requirements: [
                ...(contractAuditResult?.missing_requirements ?? []),
                ...(llmAudit.missing_requirements ?? []),
              ],
              unsupported_claims: llmAudit.unsupported_claims ?? [],
              intent_drift: llmAudit.intent_drift ?? null,
              revision_instructions: [
                ...(contractAuditResult?.revision_instructions ?? []),
                ...(llmAudit.revision_instructions ?? []),
              ],
              status: llmAudit.pass && (contractAuditResult?.pass ?? false) ? 'pass' : 'fail',
              deterministic_metrics: contractAuditResult?.deterministic_metrics,
            };
          } else {
            contractAuditResult = {
              pass: false,
              missing_requirements: contractAuditResult?.missing_requirements ?? [],
              unsupported_claims: contractAuditResult?.unsupported_claims ?? [],
              intent_drift: 'contract_auditor_parse_error',
              revision_instructions: [
                ...(contractAuditResult?.revision_instructions ?? []),
                'Contract auditor did not return parseable JSON.',
              ],
              status: 'audit_unavailable',
              deterministic_metrics: contractAuditResult?.deterministic_metrics,
            };
          }
        } catch {
          contractAuditResult = {
            pass: false,
            missing_requirements: contractAuditResult?.missing_requirements ?? [],
            unsupported_claims: contractAuditResult?.unsupported_claims ?? [],
            intent_drift: 'contract_auditor_parse_error',
            revision_instructions: [
              ...(contractAuditResult?.revision_instructions ?? []),
              'Contract auditor returned invalid JSON output.',
            ],
            status: 'audit_unavailable',
            deterministic_metrics: contractAuditResult?.deterministic_metrics,
          };
        }

        if (contractAuditResult && !contractAuditResult.pass) {
          logger.warn(`[${runId}] Contract auditor FAIL`, {
            missingRequirements: contractAuditResult.missing_requirements,
            intentDrift: contractAuditResult.intent_drift,
          });
        }
      } catch (auditErr) {
        logger.warn(`[${runId}] Contract auditor call failed`, { error: auditErr instanceof Error ? auditErr.message : String(auditErr) });
        contractAuditResult = {
          pass: false,
          missing_requirements: contractAuditResult?.missing_requirements ?? [],
          unsupported_claims: contractAuditResult?.unsupported_claims ?? [],
          intent_drift: 'contract_auditor_unavailable',
          revision_instructions: [
            ...(contractAuditResult?.revision_instructions ?? []),
            'Contract auditor provider call failed.',
          ],
          status: 'audit_unavailable',
          deterministic_metrics: contractAuditResult?.deterministic_metrics,
        };
      }
    };
    await runContractAudit(generatedReport.markdown);

    const recomputeReportStatus = (): ReportGateStatus => {
      let nextStatus: ReportGateStatus = 'completed';
      const contractFailed = contractAuditResult ? !contractAuditResult.pass : false;
      const verifierFailed = verificationUnavailable || !verification.passed || verification.overall !== 'PASS';
      if (contractFailed && verifierFailed) {
        nextStatus = 'contract_failed';
      } else if (contractFailed) {
        nextStatus = 'contract_failed';
      } else if (verifierFailed) {
        nextStatus = 'verification_failed';
      } else if (sourceCoverageShortfall) {
        nextStatus = 'completed_degraded';
        contractAuditResult = {
          pass: false,
          missing_requirements: [
            ...(contractAuditResult?.missing_requirements ?? []),
            `usable_sources_shortfall:${usableSourcesObserved}/${minimumUsableSources}`,
          ],
          unsupported_claims: contractAuditResult?.unsupported_claims ?? [],
          intent_drift: contractAuditResult?.intent_drift ?? null,
          revision_instructions: [
            ...(contractAuditResult?.revision_instructions ?? []),
            `Increase usable independent sources from ${usableSourcesObserved} to at least ${minimumUsableSources}, or explicitly downgrade output status with the shortfall disclosed.`,
          ],
          status: contractAuditResult?.status ?? 'fail',
        };
      }
      return nextStatus;
    };
    const minimumUsableSources = data.confirmedPlanPayload?.sourceStrategy?.expectedSourceCount?.min;
    const usableSourcesObserved = new Set(
      allChunks
        .map((chunk) => chunk.source_url?.trim())
        .filter((value): value is string => Boolean(value))
    ).size;
    const sourceCoverageShortfall =
      typeof minimumUsableSources === 'number' &&
      Number.isFinite(minimumUsableSources) &&
      minimumUsableSources > 0 &&
      usableSourcesObserved < minimumUsableSources;
    let reportStatus: ReportGateStatus = recomputeReportStatus();

    if (reportStatus !== 'completed' && reportStatus !== 'completed_degraded') {
      const MAX_REPAIR_ATTEMPTS = 2;
      for (
        let attempt = 1;
        attempt <= MAX_REPAIR_ATTEMPTS && reportStatus !== 'completed' && reportStatus !== 'completed_degraded';
        attempt += 1
      ) {
        await progress('verification', 93, 'Contract or verifier gate failed; attempting bounded repair pass.', {
          substep: 'repair_started',
          detail: `attempt_${attempt}`,
        });
        const contractRevisionInstructions =
          (contractAuditResult as ContractAuditResult | null)?.revision_instructions ?? [];
        const revisionInstructions = [
          ...contractRevisionInstructions,
          ...(verification.criteria ?? [])
            .filter((criterion) => criterion.status === 'FAIL')
            .map((criterion) => `${criterion.criterion}: ${criterion.note}`),
        ];
        if (revisionInstructions.length === 0) {
          break;
        }
        const repairResult = await callRoleModel({
          role: 'coherence_refiner',
          ...v2,
          runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'coherence_refiner'),
          messages: [
            { role: 'system', content: SYSTEM_PROMPTS.coherence_refiner },
            {
              role: 'user',
              content: `Revise the report to satisfy these contract and verification requirements:\n${revisionInstructions.map((line) => `- ${line}`).join('\n')}\n\nREPORT:\n${generatedReport.markdown}`,
            },
          ],
        });
        modelLog.push(repairResult);
        generatedReport = { markdown: repairResult.content.trim() || generatedReport.markdown };

        if (shouldRunPipelineStage(orchProfile, 'verification')) {
          const intentVerifierPrompt = buildVerifierPromptForIntent(orchProfile.intent);
          const reverifyResult = await callRoleModel({
            role: 'verifier',
            ...v2,
            runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'verifier'),
            messages: [
              { role: 'system', content: intentVerifierPrompt },
              {
                role: 'user',
                content: `Verify this research report meets epistemic standards:\n\n${generatedReport.markdown}`,
              },
            ],
          });
          modelLog.push(reverifyResult);
          verificationUnavailable = false;
          try {
            const jsonMatch = reverifyResult.content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              verification = JSON.parse(jsonMatch[0]) as VerificationResult;
              if (verification.overall !== 'PASS') {
                verification.passed = false;
              }
            } else {
              verificationUnavailable = true;
              verification = { passed: false, criteria: [], overall: 'UNKNOWN' };
            }
          } catch {
            verificationUnavailable = true;
            verification = { passed: false, criteria: [], overall: 'UNKNOWN' };
          }
        }

        await runContractAudit(generatedReport.markdown);
        reportStatus = recomputeReportStatus();
      }
    }

    // ────────────────────────────────────────────────────────────────
    // STAGE 8b: PLAIN LANGUAGE — sister report for general audiences
    // ────────────────────────────────────────────────────────────────
    let plainLanguageMarkdown = '';
    if (reportStatus === 'completed' && shouldRunPipelineStage(orchProfile, 'plain_language')) {
      await progress('plain_language', 93, 'Writing plain-language version of the report...', { substep: 'plain_language_started' });

      const plainLanguageResult = await callRoleModel({
        role: 'plain_language_synthesizer',
        ...v2,
        runtimeOverrides: runtimeOverrideForRole(runModelOverrides, 'plain_language_synthesizer'),
        messages: [
          { role: 'system', content: SYSTEM_PROMPTS.plain_language_synthesizer },
          {
            role: 'user',
            content: `Rewrite the following research report in plain language for a general reader. Keep uncertainty and contradictions explicit.\n\n${(typeof generatedReport?.markdown === 'string' ? generatedReport.markdown : '').slice(0, 120000)}`,
          },
        ],
      });
      modelLog.push(plainLanguageResult);
      await progress('plain_language', 93, 'Plain-language report drafted', {
        substep: 'plain_language_done',
        model: plainLanguageResult.model,
        tokenUsage: { prompt: plainLanguageResult.promptTokens, completion: plainLanguageResult.completionTokens },
      });

      plainLanguageMarkdown = plainLanguageResult.content.trim();
    } else {
      await progress('plain_language', 93, 'Plain-language pass skipped until primary report passes all gates', { substep: 'stage_skipped' });
    }

        // ────────────────────────────────────────────────────────────────
    // STAGE 9: SAVE REPORT
    // ────────────────────────────────────────────────────────────────
    await progress('saving', 94, 'Saving report to corpus...');
    const agentExecutionTelemetry = computeAgentExecutionTelemetry({
      orchProfile,
      plannedSpecialists: canonicalExecutionPlan.specialistAgents,
      specialistRan,
      specialistSkipped,
    });

    const reportMarkdown = typeof generatedReport?.markdown === 'string' ? generatedReport.markdown : '';
    const reportSections = parseReportSections(reportMarkdown);
    const opportunityObjects = orchProfile.intent === 'opportunity_discovery'
      ? extractOpportunityObjectsFromMarkdown(reportMarkdown)
      : [];
    const requestedOpportunityCount =
      confirmedResearchBrief?.requestedArtifacts.find((artifact) => typeof artifact.exactCount === 'number')
        ?.exactCount;
    const deliveredOpportunityCount = opportunityObjects.length;
    const fieldsCompleteCount =
      orchProfile.intent === 'opportunity_discovery' ? fieldCompletenessForOpportunities(opportunityObjects) : undefined;
    const contractMissingRequirements =
      (contractAuditResult as ContractAuditResult | null)?.missing_requirements ?? [];
    const constraintsPassed = confirmedResearchBrief?.userConstraints.length ?? 0;
    const constraintsFailed = reportStatus === 'completed' ? 0 : contractMissingRequirements.length;
    const usableSourceCount = new Set(
      allChunks
        .map((chunk) => chunk.source_url?.trim())
        .filter((value): value is string => Boolean(value))
    ).size;
    const independentDomainCount = countIndependentDomains(allChunks);
    const readerFrontMatter = buildReaderFrontMatter({
      intentId: orchProfile.intent,
      executiveSummary: reportSections.find((s) => s.type === 'executive_summary')?.content ?? '',
      conclusion: reportSections.find((s) => s.type === 'conclusion')?.content ?? '',
      contradictionCount: 0,
      sourceCount: new Set(allChunks.map((c) => c.source_url)).size,
      chunkCount: allChunks.length,
      falsificationCriteria: plan.falsification_criteria,
      requestedOpportunityCount,
      deliveredOpportunityCount,
      fieldsCompleteCount,
      constraintsPassed,
      constraintsFailed,
      usableSourceCount,
      independentDomainCount,
      validationExperimentCount: opportunityObjects.filter((item) => /validation/i.test(item.body)).length,
      contractStatus: reportStatus,
    });
    const prov = await queryOne<{
      supplemental: string;
      supplemental_attachments: unknown;
    }>(`SELECT supplemental, supplemental_attachments FROM research_runs WHERE id=$1`, [runId]);

    const reportId = await saveReport({
      runId,
      query: researchQuery,
      plan,
      allChunks,
      synthesizerContent: reportMarkdown,
      verification,
      discoverySummary: discoverySummary as unknown as Record<string, unknown>,
      plainLanguageMarkdown,
      readerFrontMatter,
      modelEnsemble: snapshotModelEnsemble(runModelOverrides),
      supplementalText: prov?.supplemental ?? '',
      supplementalAttachments: Array.isArray(prov?.supplemental_attachments)
        ? (prov.supplemental_attachments as Record<string, unknown>[])
        : [],
      reportGateStatus: reportStatus,
      userId: creditCtx?.userId,
      wave52Metadata: {
        output_template_id: outputTemplateId,
        orchestration_intent: orchProfile.intent,
        skeptic_mode: orchProfile.skepticMode,
        agents_planned: agentExecutionTelemetry.planned,
        agents_ran: agentExecutionTelemetry.ran,
        agents_skipped: agentExecutionTelemetry.skipped,
        specialist_execution: {
          statuses: specialistStatuses,
          degraded_coverage_reasons: degradedCoverageReasons,
        },
        ...(skepticAnnotations.length ? { skeptic_annotations: skepticAnnotations } : {}),
        specialist_findings: specialistFindings.map((finding) => ({
          role: finding.role,
          failed: finding.failed,
          error_hint: finding.errorHint ?? null,
          parsed: finding.parsed,
          parsed_preview: finding.parsed ? Object.keys(finding.parsed).slice(0, 5) : null,
          content_preview: finding.parsed ? null : finding.content ? finding.content.slice(0, 500) : null,
        })),
        // Phase B — contract audit result stored as metadata (null when skipped)
        contract_audit: contractAuditResult,
        report_gate_status: reportStatus,
      },
    });
    await saveRunCheckpoint({
      runId,
      stage: 'saving',
      checkpointKey: 'report_saved',
      snapshot: { reportId, sectionCount: reportSections.length },
    });

    // ────────────────────────────────────────────────────────────────
    // STAGE 10: EPISTEMIC PERSISTENCE — claims, contradictions, citations
    // ────────────────────────────────────────────────────────────────
    if (shouldRunPipelineStage(orchProfile, 'epistemic_persistence')) {
      await progress('epistemic_persistence', 97, 'Persisting claims, contradictions, and citations...');

      try {
        const claims = await extractAndPersistClaims({
          runId,
          reportId,
          researchQuery,
          chunks: allChunks,
          reasonerOutput: reasonerResult.content,
          synthesizerOutput: reportMarkdown,
          wave53: {
            sourceClassByChunkId: wave53SourceClassMap,
            steelmanByClaimText: wave53SteelmanByClaimKey,
          },
          ...v2,
        });

        await extractAndPersistContradictions({
          runId,
          reportId,
          chunks: allChunks,
          claims,
          skepticOutput: skepticResult.content,
          ...v2,
        });

        await mapAndPersistCitations({
          runId,
          reportId,
          chunks: allChunks,
          claims,
          reportSections,
          discoverySummary: discoverySummary as unknown as Record<string, unknown>,
          sourceClassByChunkId: wave53SourceClassMap,
          chunkContextLimit: addonEffects.citationChunkContextLimit,
          ...v2,
        });
      } catch (epistemicErr) {
        // Do not fail the run if epistemic persistence fails — log and continue
        logger.error(`[${runId}] Epistemic persistence failed:`, epistemicErr);
      }
    } else {
      await progress('epistemic_persistence', 97, 'Epistemic persistence skipped for this intent profile', {
        substep: 'stage_skipped',
      });
    }

    // Update run with model log, report_id, and completion
    const runTerminalStatus = mapGateStatusToRunStatus(reportStatus);
    const runFailureMeta =
      runTerminalStatus === 'completed'
        ? {}
        : {
            gate_status: reportStatus,
            verification,
            contract_audit: contractAuditResult,
          };
    await query(
      `UPDATE research_runs SET status=$1, completed_at=NOW(), model_log=$2, report_id=$3, failed_stage=$4, failure_meta=$5::jsonb WHERE id=$6`,
      [
        runTerminalStatus,
        JSON.stringify(modelLog),
        reportId,
        runTerminalStatus === 'completed' ? null : 'verification',
        JSON.stringify(runFailureMeta),
        runId,
      ]
    );
    patchAgentExecutionsReportIdForRun(runId, reportId);

    const preStatsNow = Date.now();
    if (currentStage && phaseStartTimes[currentStage] != null) {
      phaseDurations[currentStage] =
        (phaseDurations[currentStage] ?? 0) + (preStatsNow - phaseStartTimes[currentStage]!);
    }

    const stageDurationPayload: Record<string, number | string | null> = {
      _profileDisplayName: orchProfile.displayName,
      _intentId: orchProfile.intent,
    };
    for (const s of PIPELINE_STAGES) {
      stageDurationPayload[s] = shouldRunPipelineStage(orchProfile, s)
        ? Math.round(phaseDurations[s] ?? 0)
        : null;
    }
    await aggregateAndPersistDossierStatistics(runId, {
      profileDisplayName: orchProfile.displayName,
      intentId: orchProfile.intent,
      agentsRan: agentExecutionTelemetry.ran,
      agentsSkipped: agentExecutionTelemetry.skipped,
      stageDurations: stageDurationPayload,
      skepticAnnotationsCount: skepticAnnotations.length > 0 ? skepticAnnotations.length : null,
      sourceClassBreakdown:
        shouldRunPipelineStage(orchProfile, 'retriever_analysis') && allChunks.length > 0
          ? wave53SourceClassBreakdown
          : null,
      steelmanPassCount: wave53SteelmanPassCount,
    });

    // Credit charge: consume hold on success, decrement subscription quota
    if (creditCtx && runTerminalStatus === 'completed') {
      try {
        if (creditCtx.holdId && creditCtx.userId) {
          await consumeHold(creditCtx.holdId, creditCtx.userId, runId);
        }
        if (creditCtx.type === 'subscription' && creditCtx.userId) {
          await incrementReportCount(creditCtx.userId, engineVersion === 'v2');
        }
      } catch (creditErr) {
        logger.error('credit_charge_on_completion_failed', {
          runId,
          creditCtx,
          error: creditErr instanceof Error ? creditErr.message : 'Unknown',
        });
      }
    } else if (creditCtx?.holdId && creditCtx.userId) {
      await releaseHold(creditCtx.holdId, creditCtx.userId).catch((err) => {
        logger.warn('credit_hold_release_non_success_status_failed', {
          runId,
          status: runTerminalStatus,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    // Pipeline B: evaluate eligibility and enqueue sanitized artifact if eligible
    if (creditCtx?.userId && shouldRunPipelineBFromGateStatus(reportStatus)) {
      try {
        const { evaluatePipelineBEligibility } = await import('../ingestion/pipelineBEligibility');
        const { getUserTier } = await import('../tier/tierService');
        const userTier = await getUserTier(creditCtx.userId);
        const eligibility = await evaluatePipelineBEligibility(runId, creditCtx.userId, userTier.tier, runTerminalStatus);
        if (eligibility.eligible) {
          const { sanitize } = await import('../ingestion/sanitizationGate');
          const { pipelineBIngestionQueue } = await import('../../queue/queues');
          const { writeAuditLog } = await import('../ingestion/auditLogger');
          const sanitized = sanitize({
            runId,
            reportMarkdown: generatedReport.markdown,
            claims: [],
            contradictions: [],
            metadata: { research_objective: researchObjective, engine_version: engineVersion },
          });
          await writeAuditLog(runId, creditCtx.userId, 'sanitization_completed', { contentHash: sanitized.contentHash });
          await pipelineBIngestionQueue.add('pipeline-b-ingest', {
            runId,
            userId: creditCtx.userId,
            contentHash: sanitized.contentHash,
            sanitizedContent: sanitized.reportMarkdown,
          }, { jobId: `pb_${runId}` });
          await writeAuditLog(runId, creditCtx.userId, 'eligibility_check', { eligible: true });
        }
      } catch (pbErr) {
        logger.warn('pipeline_b_enqueue_failed', { runId, error: pbErr instanceof Error ? pbErr.message : 'Unknown' });
      }
    }

    await progress('done', 100, 'Research complete');
    await appendRunProgressEvent(runId, {
      runId,
      stage: 'done',
      percent: 100,
      message: 'Research complete',
      timestamp: new Date().toISOString(),
      eventType: 'run_completed',
    });

    await query(
      `UPDATE research_runs SET progress_stage=NULL, progress_percent=NULL, progress_message=NULL, progress_updated_at=NULL, resume_job_payload=NULL WHERE id=$1`,
      [runId]
    );

    // Finalise the last active phase duration before building the summary.
    const finalNow = Date.now();
    if (currentStage && phaseStartTimes[currentStage] != null) {
      phaseDurations[currentStage] = (phaseDurations[currentStage] ?? 0) + (finalNow - phaseStartTimes[currentStage]);
    }
    const summary: RunSummaryPayload = buildRunSummary({
      runId, status: 'completed',
      startedAt: runStartedAt, finishedAt: finalNow,
      phaseDurations, modelLog,
    });

    return { runId, reportId, summary };
  } catch (err) {
    if (err instanceof ResearchCancelledError) {
      await query(
        `UPDATE research_runs SET status='cancelled', error_message=$1, completed_at=NOW(), progress_stage=NULL, progress_percent=NULL, progress_message=NULL, progress_updated_at=NULL WHERE id=$2`,
        ['Cancelled by user', runId]
      );
      await clearRunCancelled(runId);
      const cancelledNow = Date.now();
      if (currentStage && phaseStartTimes[currentStage] != null) {
        phaseDurations[currentStage] = (phaseDurations[currentStage] ?? 0) + (cancelledNow - phaseStartTimes[currentStage]);
      }
      const cancelledSummary: RunSummaryPayload = buildRunSummary({
        runId, status: 'cancelled',
        startedAt: runStartedAt, finishedAt: cancelledNow,
        phaseDurations, modelLog,
        failedStage: currentStage, errorMessage: 'Cancelled by user',
      });
      const cancelledErrWithSummary = err as Error & { summary?: RunSummaryPayload };
      cancelledErrWithSummary.summary = cancelledSummary;
      throw cancelledErrWithSummary;
    }
    const failureDetails = buildResearchFailureDetails(err, currentStage);

    // Look up retry-budget. If columns do not exist yet (migration 012 has
    // not applied), default to 0/3 — the state machine will treat this as
    // "first attempt, recoverable" which is what the row actually is.
    let retryAttempts = 0;
    let retryBudget = 3;
    try {
      const budgetRow = await queryOne<{ retry_attempts: number | null; retry_budget: number | null }>(
        `SELECT retry_attempts, retry_budget FROM research_runs WHERE id=$1`,
        [runId]
      );
      retryAttempts = Number(budgetRow?.retry_attempts ?? 0);
      retryBudget = Number(budgetRow?.retry_budget ?? 3);
    } catch (budgetErr) {
      logger.warn(`Research run ${runId}: could not read retry budget; assuming defaults`, budgetErr);
    }

    // Single source of truth for retryable / terminal / aborted-vs-failed.
    // The row UPDATE, the progress_event entry, and the thrown error (which
    // the worker re-emits as a socket event) all come from this one tuple.
    const transition = decideRunStateOnFailure({
      raw: failureDetails.failureMeta,
      classifierRetryable: failureDetails.retryable,
      retryAttempts,
      retryBudget,
    });
    const failureMetaWithResume = transition.failureMeta;
    const finalStatus = transition.nextStatus;

    try {
      await query(
        `UPDATE research_runs
            SET status=$5,
                error_message=$1,
                failed_stage=$2,
                failure_meta=$3,
                completed_at=NOW(),
                progress_stage=NULL,
                progress_percent=NULL,
                progress_message=NULL,
                progress_updated_at=NULL,
                resume_job_payload=CASE WHEN $5 = 'aborted' THEN NULL ELSE $6 END
          WHERE id=$4`,
        [
          failureDetails.errorMessage,
          currentStage,
          JSON.stringify(failureMetaWithResume),
          runId,
          finalStatus,
          JSON.stringify(resumeJobPayload),
        ]
      );
    } catch (dbErr) {
      logger.error(`Research run ${runId}: failed to persist failure row`, dbErr);
      // If the primary UPDATE failed (most likely because the 'aborted'
      // enum value is not yet in place — migration 012 has not applied
      // yet on this deploy), retry the UPDATE as 'failed' so the row
      // still settles into a terminal state the rest of the API
      // understands. We mirror every field from the primary UPDATE so
      // failed_stage / progress_* / resume_job_payload do not stay
      // stale — the Copilot review on PR #40 flagged that the previous
      // fallback only updated status/error_message/completed_at, leaving
      // the polling path's `failed_stage || progress_stage` reading the
      // old in-progress values. We force status='failed' (never
      // 'aborted') so this branch is never the one that exercises the
      // missing enum value.
      const safeStatus = 'failed' as const;
      try {
        await query(
          `UPDATE research_runs
              SET status=$5,
                  error_message=$1,
                  failed_stage=$2,
                  failure_meta=$3,
                  completed_at=NOW(),
                  progress_stage=NULL,
                  progress_percent=NULL,
                  progress_message=NULL,
                  progress_updated_at=NULL,
                  resume_job_payload=$6
            WHERE id=$4`,
          [
            failureDetails.errorMessage.slice(0, 2000),
            currentStage,
            JSON.stringify(failureMetaWithResume),
            runId,
            safeStatus,
            // If the canonical decision was 'aborted' but we are forced to
            // persist as 'failed' here, still drop the resume payload so
            // the UI cannot offer Resume on a row that the state machine
            // marked terminal.
            transition.keepResumePayload ? JSON.stringify(resumeJobPayload) : null,
          ]
        );
      } catch (fallbackErr) {
        logger.error(`Research run ${runId}: fallback failure UPDATE also failed`, fallbackErr);
      }
    }

    // Best-effort: set workspace retention expiry for the terminal run.
    // Deploy-skew safe — markRunTerminalRetention catches 42703.
    try {
      await markRunTerminalRetention(runId, finalStatus, new Date());
    } catch (retErr) {
      logger.warn('retention_mark_terminal_error', {
        runId,
        finalStatus,
        error: retErr instanceof Error ? retErr.message : 'Unknown',
      });
    }

    await appendRunProgressEvent(runId, {
      runId,
      stage: finalStatus === 'aborted' ? 'aborted' : currentStage,
      percent: currentPercent,
      message:
        finalStatus === 'aborted'
          ? `Run aborted — ${
              failureMetaWithResume.abortReason === 'budget_exhausted'
                ? `retry budget (${retryBudget}) exhausted`
                : 'failure was non-recoverable'
            }. ${currentMessage}`
          : currentMessage,
      timestamp: new Date().toISOString(),
      eventType: finalStatus === 'aborted' ? 'run_aborted' : 'run_failed',
      failure: {
        errorMessage: failureDetails.errorMessage,
        retryable: failureMetaWithResume.retryable,
        failureMeta: failureMetaWithResume as unknown as Record<string, unknown>,
      },
    });
    logger.error(`Research run ${runId} failed:`, err);

    // Finalise phase timing before building the failure summary.
    const failedNow = Date.now();
    if (currentStage && phaseStartTimes[currentStage] != null) {
      phaseDurations[currentStage] = (phaseDurations[currentStage] ?? 0) + (failedNow - phaseStartTimes[currentStage]);
    }
    const failureSummary: RunSummaryPayload = buildRunSummary({
      runId, status: finalStatus,
      startedAt: runStartedAt, finishedAt: failedNow,
      phaseDurations, modelLog,
      failedStage: currentStage,
      errorMessage: failureDetails.errorMessage,
      failureMeta: failureMetaWithResume as unknown as Record<string, unknown>,
    });

    // Propagate the *state-machine-finalized* metadata to the BullMQ worker.
    // The worker derives 'research:aborted' vs 'research:failed' from
    // `failureMeta.terminal`, so this guarantees the realtime socket event
    // matches the row we just persisted.
    const enrichedError = Object.assign(new Error(failureDetails.errorMessage), {
      runId,
      stage: finalStatus === 'aborted' ? 'aborted' : currentStage,
      percent: currentPercent,
      message: currentMessage,
      retryable: failureMetaWithResume.retryable,
      failureMeta: failureMetaWithResume as unknown as Record<string, unknown>,
      summary: failureSummary,
    });

    // Release wallet hold on failure — DO NOT charge for failed runs.
    // For terminal failures (aborted, non-retryable), release immediately.
    // For retryable failures, hold is kept for the retry attempt (it carries
    // forward via resumeJobPayload.creditChargeContext).
    if (creditCtx?.holdId && creditCtx.userId) {
      const isTerminal = finalStatus === 'aborted' || !failureMetaWithResume.retryable;
      if (isTerminal) {
        try {
          await releaseHold(creditCtx.holdId, creditCtx.userId);
        } catch (releaseErr) {
          logger.error('credit_hold_release_on_failure_failed', {
            runId,
            holdId: creditCtx.holdId,
            error: releaseErr instanceof Error ? releaseErr.message : 'Unknown',
          });
        }
      }
    }

    // Fire-and-forget: report terminal failures to GitHub Issues so agents
    // can triage and respond. Never awaited — must not affect the error path.
    if (finalStatus === 'aborted') {
      void reportRunErrorToGitHub({
        runId,
        stage: currentStage,
        errorMessage: failureDetails.errorMessage,
        failureMeta: failureMetaWithResume as unknown as Record<string, unknown>,
        query: researchQuery,
        userId: creditCtx?.userId ?? null,
        timestamp: new Date().toISOString(),
      });
    }

    throw enrichedError;
  }
}

function buildRunSummary(args: {
  runId: string;
  status: string;
  startedAt: number;
  finishedAt: number;
  phaseDurations: Record<string, number>;
  modelLog: ModelCallResult[];
  failedStage?: string | null;
  errorMessage?: string | null;
  failureMeta?: Record<string, unknown> | null;
}): RunSummaryPayload {
  const totalPromptTokens = args.modelLog.reduce((s, r) => s + (r.promptTokens ?? 0), 0);
  const totalCompletionTokens = args.modelLog.reduce((s, r) => s + (r.completionTokens ?? 0), 0);
  const retryCount = args.modelLog.filter((r) => r.usedFallback).length;
  const orchestratorHints = Array.isArray(args.failureMeta?.orchestratorHints)
    ? (args.failureMeta!.orchestratorHints as string[])
    : [];
  return {
    runId: args.runId,
    status: args.status,
    totalDurationMs: args.finishedAt - args.startedAt,
    phaseDurations: { ...args.phaseDurations },
    totalPromptTokens,
    totalCompletionTokens,
    retryCount,
    failedStage: args.failedStage ?? null,
    errorMessage: args.errorMessage ?? null,
    failureMeta: args.failureMeta ?? null,
    orchestratorHints,
    modelUsage: args.modelLog.map((r) => ({
      role: r.role,
      model: r.model,
      promptTokens: r.promptTokens ?? 0,
      completionTokens: r.completionTokens ?? 0,
      durationMs: r.durationMs ?? 0,
    })),
  };
}

function buildResearchFailureDetails(err: unknown, stage: string): ResearchFailureDetails {
  const errWithMeta = err as Error & { failureMeta?: Record<string, unknown>; retryable?: boolean };
  if (errWithMeta.failureMeta && typeof errWithMeta.failureMeta === 'object') {
    const meta = { ...errWithMeta.failureMeta } as Record<string, unknown>;
    mergeOrchestratorHintsIntoFailureMeta(meta);
    return {
      errorMessage: errWithMeta.message || 'Request failed',
      failureMeta: meta,
      retryable: Boolean(errWithMeta.retryable),
    };
  }
  if (err instanceof NormalizedModelError) {
    const upstream = err.upstream || (isHfRepoModel(err.model) ? 'huggingface_inference' : 'openrouter');
    const endpoint =
      err.endpoint
      || (upstream === 'huggingface_inference'
        ? 'https://api-inference.huggingface.co'
        : upstream === 'together'
          ? `${config.together.baseUrl.replace(/\/+$/, '')}/chat/completions`
          : `${config.openrouter.baseUrl}/chat/completions`);
    const providerMessage = err.providerMessage || 'No provider message returned';
    const status = err.status ?? 'unknown';
    const retryable = err.classification === 'rate_limited' || err.classification === 'provider_unavailable';
    const failureMeta: Record<string, unknown> = {
      classification: err.classification,
      status: err.status,
      providerMessage,
      model: err.model,
      fallbackTried: err.fallbackTried,
      role: err.role,
      endpoint,
      upstream,
      providerFallbackAttempted: err.providerFallbackAttempted === true,
      providerFallbackBackend: err.providerFallbackBackend || null,
      providerFallbackResult: err.providerFallbackResult || null,
    };
    mergeOrchestratorHintsIntoFailureMeta(failureMeta);
    return {
      errorMessage: `Model provider request failed at ${stage} (role=${err.role}, model=${err.model}, status=${status}, classification=${err.classification}): ${providerMessage}`,
      failureMeta,
      retryable,
    };
  }
  if (axios.isAxiosError(err)) {
    return buildAxiosFailureDetails(err, stage);
  }
  const errorMessage = err instanceof Error ? err.message : String(err);
  const lower = errorMessage.toLowerCase();
  const hints: string[] = [];
  if (lower.includes('hf_token') || lower.includes('hugging face token')) {
    hints.push('HF_TOKEN may be missing or invalid on the server.');
  }
  if (lower.includes('openrouter') || lower.includes('chat/completions')) {
    hints.push('Check OPENROUTER_API_KEY and OPENROUTER_BASE_URL (must be the API base, e.g. https://openrouter.ai/api/v1, not .../chat/completions).');
  }
  // Internal/unknown errors (e.g. a TypeError thrown by a downstream parser
  // when a model returns unexpected JSON shape). Previously this branch
  // returned `retryable: false` which produced the contradictory
  // "Run aborted — 0 of 3 retries used · 3 remaining" UI: the row had
  // budget left but the state-machine refused to use it. Mark these as
  // retryable so the run can resume from its last checkpoint and burn
  // through the budget the user already sees on screen.
  const isInternalProgramError =
    err instanceof TypeError ||
    err instanceof RangeError ||
    err instanceof ReferenceError ||
    err instanceof SyntaxError;
  if (isInternalProgramError) {
    hints.push(
      'Internal error detected. The orchestrator will mark this retryable so the run can resume from its last checkpoint; if it keeps reproducing, this is a server-side bug and should be reported.'
    );
  }
  return {
    errorMessage,
    failureMeta: {
      classification: isInternalProgramError ? 'internal_error' : 'unknown_error',
      ...(hints.length ? { orchestratorHints: hints } : {}),
    },
    retryable: isInternalProgramError,
  };
}

function buildAxiosFailureDetails(err: AxiosError, stage: string): ResearchFailureDetails {
  const status = err.response?.status;
  const endpoint = err.config?.url;
  const method = err.config?.method ? err.config.method.toUpperCase() : 'GET';
  const providerMessage = extractAxiosProviderMessage(err);
  const classification = classifyAxiosError(status);
  const statusLabel = status ?? 'network_error';
  const retryable =
    classification === 'rate_limited'
    || classification === 'provider_unavailable'
    || classification === 'network_error';

  const openrouterBase = config.openrouter.baseUrl.replace(/\/+$/, '');
  const isOpenRouterCall = typeof endpoint === 'string' && endpoint.startsWith(openrouterBase);
  const noAllowedProviders =
    isOpenRouterCall && status === 404 && /no allowed providers/i.test(providerMessage);
  const wrongOrEndpoint =
    isOpenRouterCall && status === 404 && !noAllowedProviders;
  const trailingHint = noAllowedProviders
    ? ' OpenRouter rejected the model on this account because every upstream provider is excluded by the account-level privacy / data-collection filter. Open the V2 page and switch the failing role to a model with broader provider coverage, or set OPENROUTER_DATA_COLLECTION=allow on the server.'
    : wrongOrEndpoint
      ? ' If this URL is OpenRouter, verify the model slug exists in https://openrouter.ai/api/v1/models and that OPENROUTER_BASE_URL is the API base (e.g. https://openrouter.ai/api/v1, not .../chat/completions).'
      : '';

  const hints: string[] = [];
  if (retryable) {
    hints.push('You can use "Resume from last failure" on the Research page if the run saved a retry payload.');
  }
  if (classification === 'provider_unavailable' && isOpenRouterCall) {
    hints.push('OpenRouter may be temporarily unavailable; wait and retry, or verify billing/rate limits.');
  }

  return {
    errorMessage: `Upstream request failed at ${stage} (${method} ${endpoint ?? 'unknown endpoint'}, status=${statusLabel}, classification=${classification}): ${providerMessage}${trailingHint}`,
    failureMeta: {
      classification,
      status,
      providerMessage,
      endpoint,
      method,
      code: err.code,
      ...(isOpenRouterCall ? { upstream: 'openrouter' } : {}),
      ...(hints.length ? { orchestratorHints: hints } : {}),
    },
    retryable,
  };
}

function classifyAxiosError(status?: number): string {
  if (!status) return 'network_error';
  if (status === 404) return 'endpoint_not_found';
  if (status === 429) return 'rate_limited';
  if (status === 401 || status === 403) return 'auth_error';
  if (status === 400) return 'bad_request';
  if (status >= 500) return 'provider_unavailable';
  return 'unknown';
}

function extractAxiosProviderMessage(err: AxiosError): string {
  const data = err.response?.data as unknown;
  if (typeof data === 'string') return data;
  if (data && typeof data === 'object') {
    const maybe = data as { error?: { message?: string }; message?: string; detail?: string };
    return maybe.error?.message || maybe.message || maybe.detail || JSON.stringify(data);
  }
  return err.message;
}

function formatEvidenceContext(chunks: RetrievedChunk[]): string {
  return chunks
    .map((c, i) => [
      `[CHUNK ${i + 1}] ID: ${c.id}`,
      `Source: ${c.source_title || c.source_url || 'Unknown'}`,
      `Similarity: ${c.similarity.toFixed(3)}`,
      c.evidence_tier ? `Evidence Tier: ${c.evidence_tier}` : '',
      `Content:\n${c.content}`,
      '---',
    ].filter(Boolean).join('\n'))
    .join('\n\n');
}

async function saveReport(args: {
  runId: string;
  query: string;
  plan: ResearchPlan;
  allChunks: RetrievedChunk[];
  synthesizerContent: string;
  verification: VerificationResult;
  discoverySummary?: Record<string, unknown>;
  plainLanguageMarkdown?: string;
  readerFrontMatter?: ReaderFrontMatter;
  modelEnsemble?: Record<string, unknown>;
  supplementalText: string;
  supplementalAttachments: Record<string, unknown>[];
  reportGateStatus: ReportGateStatus;
  userId?: string;
  /** Wave 5.2 — merged into `reports.metadata` (JSON-safe keys). */
  wave52Metadata?: Record<string, unknown>;
}): Promise<string> {
  const {
    runId,
    query: researchQuery,
    plan,
    allChunks,
    synthesizerContent,
    verification,
    discoverySummary,
    plainLanguageMarkdown,
    readerFrontMatter,
    modelEnsemble,
    supplementalText,
    supplementalAttachments,
    reportGateStatus,
    userId,
    wave52Metadata,
  } = args;

  // Parse sections from synthesizer output
  const sections = parseReportSections(synthesizerContent);

  let reportId!: string;

  await withTransaction(async (client) => {
    const safeFalsification = Array.isArray(plan?.falsification_criteria)
      ? plan.falsification_criteria.filter((c) => typeof c === 'string').join('\n')
      : '';
    const safeChunks = Array.isArray(allChunks) ? allChunks : [];
    const baseParams = [
      runId,
      researchQuery.slice(0, 200),
      researchQuery,
      mapGateStatusToReportRowStatus(reportGateStatus),
      sections.find(s => s.type === 'executive_summary')?.content ?? '',
      sections.find(s => s.type === 'conclusion')?.content ?? '',
      safeFalsification,
      new Set(safeChunks.map((c) => c.source_url)).size,
      safeChunks.length,
      reportGateStatus === 'completed' ? new Date() : null,
    ];
    let reportResult: { rows: Array<{ id: string }> };
    await client.query('SAVEPOINT pre_report_insert');
    try {
      reportResult = await client.query(
        `INSERT INTO reports (run_id, title, query, status, executive_summary, conclusion, falsification_criteria, source_count, chunk_count, finalized_at, user_id)
         VALUES ($1, $2, $3, $4::report_status, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [...baseParams, userId ?? null]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await client.query('ROLLBACK TO SAVEPOINT pre_report_insert');
      reportResult = await client.query(
        `INSERT INTO reports (run_id, title, query, status, executive_summary, conclusion, falsification_criteria, source_count, chunk_count, finalized_at)
         VALUES ($1, $2, $3, $4::report_status, $5, $6, $7, $8, $9, $10) RETURNING id`,
        baseParams
      );
    }
    reportId = reportResult.rows[0].id;

    // Insert all sections
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      await client.query(
        `INSERT INTO report_sections (report_id, section_type, title, content, section_order)
         VALUES ($1, $2, $3, $4, $5)`,
        [reportId, sec.type, sec.title, sec.content, i + 1]
      );
    }

    // Store verification metadata
    await client.query(
      `UPDATE reports SET metadata=$1 WHERE id=$2`,
      [
        JSON.stringify({
          verification,
          plan,
          discovery: discoverySummary ?? null,
          research_request: {
            query: researchQuery,
            supplemental: supplementalText,
            supplemental_attachments: supplementalAttachments,
          },
          ...(plainLanguageMarkdown && plainLanguageMarkdown.length > 0
            ? { plain_language_markdown: plainLanguageMarkdown }
            : {}),
          ...(readerFrontMatter ? { reader_front_matter: readerFrontMatter } : {}),
          ...(modelEnsemble ? { model_ensemble: modelEnsemble } : {}),
          ...(wave52Metadata && Object.keys(wave52Metadata).length > 0 ? wave52Metadata : {}),
        }),
        reportId,
      ]
    );
  });

  // Best-effort retention timestamps. Finalized report retention is applied only
  // when all gates pass; non-passing reports remain under review.
  try {
    const runStatus = mapGateStatusToRunStatus(reportGateStatus);
    if (reportGateStatus === 'completed') {
      await markReportFinalizedRetention(reportId, new Date());
    }
    await markRunTerminalRetention(runId, runStatus, new Date());
  } catch (retErr) {
    logger.warn('retention_mark_terminal_error', {
      reportId,
      runId,
      reportGateStatus,
      error: retErr instanceof Error ? retErr.message : 'Unknown',
    });
  }

  return reportId;
}

function parseReportSections(content: string | undefined | null): Array<{ type: string; title: string; content: string }> {
  if (typeof content !== 'string' || content.length === 0) {
    return [{ type: 'body', title: 'Report', content: typeof content === 'string' ? content : '' }];
  }
  const SECTION_MAP: Record<string, string> = {
    'executive summary': 'executive_summary',
    'research question': 'research_question',
    'evidence ledger': 'evidence_ledger',
    'reasoning': 'reasoning',
    'contradiction': 'contradiction_analysis',
    'challenge': 'challenges',
    'synthesis': 'synthesis',
    'conclusion': 'conclusion',
    'falsification': 'falsification_criteria',
    'unresolved': 'unresolved_questions',
    'recommended': 'recommended_queries',
    'opportunities list': 'opportunities_list',
    'viability analysis': 'viability_analysis',
    'build guidance': 'build_guidance',
    'caveats': 'caveats',
    'plan phases': 'plan_phases',
    'detailed steps': 'detailed_steps',
    'acceptance criteria': 'acceptance_criteria',
    'dimensions table': 'dimensions_table',
    'chronology': 'chronology',
    'sources': 'sources',
  };

  const headerRegex = /^#{1,3}\s+(.+)$/m;
  const lines = content.split('\n');
  const sections: Array<{ type: string; title: string; content: string }> = [];

  let currentTitle = 'Report';
  let currentType = 'body';
  let currentLines: string[] = [];

  for (const line of lines) {
    if (headerRegex.test(line)) {
      if (currentLines.length > 0) {
        sections.push({
          type: currentType,
          title: currentTitle,
          content: currentLines.join('\n').trim(),
        });
      }
      currentTitle = line.replace(/^#+\s+/, '');
      currentType = 'body';
      for (const [key, type] of Object.entries(SECTION_MAP)) {
        if (currentTitle.toLowerCase().includes(key)) {
          currentType = type;
          break;
        }
      }
      currentLines = [];
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0) {
    sections.push({ type: currentType, title: currentTitle, content: currentLines.join('\n').trim() });
  }

  // If no sections were parsed, treat the whole thing as body
  if (sections.length === 0) {
    sections.push({ type: 'body', title: 'Report', content: content });
  }

  return sections;
}

/**
 * Wave 5.1 — resume the main pipeline after the user confirmed the gate plan.
 * Reads `resume_job_payload` written at park time and re-enters `runResearchJob`
 * with `skipPlanConfirmationGate: true` (Rule 33).
 */
export async function resumeAfterPlanConfirmation(
  runId: string,
  confirmedPlanId: string,
  onProgress: ProgressCallback
): Promise<ResearchJobResult> {
  const planOk = await queryOne<{ id: string }>(
    `SELECT id FROM research_plans WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'confirmed'`,
    [confirmedPlanId, runId]
  );
  if (!planOk) {
    throw Object.assign(new Error('Confirmed plan not found for this run'), {
      code: 'PLAN_RESUME_INVALID',
      statusCode: 400,
      // Queue-before-confirm race: worker may run before confirm writes `status='confirmed'`.
      retryable: true,
    });
  }
  const planPayloadRow = await queryOne<{ plan_payload: unknown }>(
    `SELECT plan_payload FROM research_plans WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'confirmed'`,
    [confirmedPlanId, runId]
  );
  const row = await queryOne<{ resume_job_payload: unknown }>(
    `SELECT resume_job_payload FROM research_runs WHERE id = $1::uuid`,
    [runId]
  );
  if (!row?.resume_job_payload || typeof row.resume_job_payload !== 'object' || Array.isArray(row.resume_job_payload)) {
    throw Object.assign(new Error('Missing resume job payload'), {
      code: 'PLAN_RESUME_INVALID',
      statusCode: 400,
    });
  }
  const payload = row.resume_job_payload as ResearchJobData;
  if (payload.runId !== runId) {
    throw Object.assign(new Error('Resume payload runId mismatch'), { code: 'PLAN_RESUME_INVALID', statusCode: 400 });
  }
  payload.skipPlanConfirmationGate = true;
  const rawPlan = planPayloadRow?.plan_payload;
  if (rawPlan && typeof rawPlan === 'object' && !Array.isArray(rawPlan)) {
    payload.confirmedPlanPayload = mergePlanPayloadWithCanonicalProfile(rawPlan as PlanPayload);
  }
  return runResearchJob(payload, onProgress);
}
