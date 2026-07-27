/**
 * Cost telemetry sidecar — AsyncLocalStorage run scope + emit-and-forget writer.
 *
 * The orchestrator wraps the run body with `runScope.run({...}, fn)`.
 * Every nested `callRoleModel` calls `emitCallTelemetry(result, options)`
 * which reads the current scope and writes one row to `agent_executions`.
 *
 * Per Cursor rule 25:
 *   I-1: only `callRoleModel` calls emitCallTelemetry.
 *   I-2: run scope is set by orchestrator/discovery/revision/generator only.
 *   I-3: writes are non-blocking and swallow errors.
 *   I-4: idempotency key (run + role + purpose + time + model + invocation id).
 *   I-6: deploy-skew tolerance — Postgres 42P01 logged at DEBUG.
 *
 * See: docs/COST_SIDECAR_DESIGN.md
 */
import { AsyncLocalStorage } from 'async_hooks';
import { createHash, randomUUID } from 'crypto';
import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';
import { computeCostUsd, getModelPrice } from './pricingCatalog';
import type { ModelCallResult } from '../openrouter/openrouterService';

// ────────────────────────────────────────────────────────────────────
// Run scope (AsyncLocalStorage)
// ────────────────────────────────────────────────────────────────────

export interface RunScopeContext {
  /** Research run id (research_runs.id). Optional only for ad-hoc calls. */
  runId?: string | null;
  /** Report id once known (assigned post-publication). Optional during run. */
  reportId?: string | null;
  /** Owning user (users.id — Clerk user id). */
  userId?: string | null;
  /** Owning org (orgs.id). */
  orgId?: string | null;
  /**
   * Pipeline phase override. When set, takes precedence over the
   * `rolePhaseFor(role)` mapping. Used when discovery's nested calls
   * want to surface as `Discovery` rather than `Planning` even though
   * they use the `planner` role.
   */
  phaseOverride?: PipelinePhase;
}

const store = new AsyncLocalStorage<RunScopeContext>();

export const runScope = {
  /**
   * Wrap a function so all nested `callRoleModel` calls inherit this scope.
   * If already inside a scope, the inner scope is layered ON TOP (not merged
   * — `getStore` returns the innermost context). Discovery calling
   * `runScope.run({...nested}, ...)` from inside an orchestrator scope is
   * the documented pattern; the inner scope inherits ids from the outer
   * via spread at the call site.
   */
  run<T>(ctx: RunScopeContext, fn: () => Promise<T>): Promise<T> {
    return store.run(ctx, fn);
  },
  /** Returns the current scope, or null when called outside any `.run`. */
  current(): RunScopeContext | null {
    return store.getStore() ?? null;
  },
};

// ────────────────────────────────────────────────────────────────────
// Role → Phase mapping
// ────────────────────────────────────────────────────────────────────

/**
 * Pipeline phase. These are the human-grouped stages the admin dashboard
 * uses for cost-breakdown analytics ("the Skeptic phase ate 38% of the
 * cost this week"). Stable enum — do not rename without updating the
 * frontend `PHASE_COLORS` map.
 */
export type PipelinePhase =
  | 'Planning'
  | 'Discovery'
  | 'Retrieval'
  | 'Reasoning'
  | 'Skeptic'
  | 'Synthesis'
  | 'Verification'
  | 'Plain Language'
  | 'Claim Extraction'
  | 'Contradiction Extraction'
  | 'Citation Mapping'
  | 'Report Generation'
  | 'Revision'
  | 'Other';

/**
 * Map a ReasoningModelRole (canonical id from reasoningModelPolicy.ts)
 * to a pipeline phase for analytics grouping.
 *
 * Per rule 25 (I-9): if you add a new role, add its mapping HERE in the
 * same commit, or the new role will be bucketed as "Other" and the
 * Skeptic-bottleneck analysis will be wrong.
 *
 * The `call_purpose` field gives us a second axis for cases where the
 * same role serves different phases (e.g. `planner` role inside the
 * discovery service is logically Discovery, not Planning).
 */
export function rolePhaseFor(role: string, callPurpose?: string): PipelinePhase {
  // Call-purpose overrides win first.
  if (callPurpose === 'pipeline_skeptic') return 'Skeptic';
  if (callPurpose === 'contradiction_extraction') return 'Contradiction Extraction';
  if (
    callPurpose === 'wave5_intent_classification' ||
    callPurpose === 'wave5_plan_generation' ||
    callPurpose === 'wave5_plan_refinement'
  ) {
    return 'Planning';
  }

  switch (role) {
    case 'planner':
      return 'Planning';
    case 'retriever':
    case 'source_class_classifier':
      return 'Retrieval';
    case 'reasoner':
    case 'steelman':
      return 'Reasoning';
    case 'skeptic':
    case 'internal_challenger':
      return 'Skeptic';
    case 'synthesizer':
    case 'outline_architect':
    case 'section_drafter':
    case 'coherence_refiner':
      return 'Synthesis';
    case 'verifier':
    case 'citation_integrity_checker':
    case 'final_revision_verifier':
    case 'contract_auditor':
      return 'Verification';
    case 'market_scout':
    case 'competitor_mapper':
    case 'demand_signal_analyst':
      return 'Discovery';
    case 'feasibility_architect':
    case 'story_verifier':
    case 'timeline_reconstructor':
    case 'data_analysis_specialist':
    case 'quantitative_quality_auditor':
      return 'Reasoning';
    case 'citation_formatter':
      return 'Citation Mapping';
    case 'plain_language_synthesizer':
      return 'Plain Language';
    case 'revision_intake':
    case 'report_locator':
    case 'change_planner':
    case 'section_rewriter':
      return 'Revision';
    default:
      return 'Other';
  }
}

// ────────────────────────────────────────────────────────────────────
// Idempotency key
// ────────────────────────────────────────────────────────────────────

/**
 * sha256(run_id || agent_role || call_purpose || started_at_ms || model
 *        || telemetry_invocation_id). Hex-encoded.
 *
 * Per rule 25 (I-4): primary + fallback within the same `callRoleModel`
 * share one `telemetryInvocationId` but produce different keys because
 * `model` differs. Parallel `callRoleModel` invocations get distinct
 * invocation ids so `Promise.all` same-ms calls never collide on
 * `ON CONFLICT DO NOTHING`.
 */
function computeIdempotencyKey(args: {
  runId: string | null | undefined;
  agentRole: string;
  callPurpose: string;
  startedAtMs: number;
  model: string;
  telemetryInvocationId: string;
}): string {
  const payload = `${args.runId ?? ''}|${args.agentRole}|${args.callPurpose}|${args.startedAtMs}|${args.model}|${args.telemetryInvocationId}`;
  return createHash('sha256').update(payload).digest('hex');
}

// ────────────────────────────────────────────────────────────────────
// Emit
// ────────────────────────────────────────────────────────────────────

export interface EmitOptions {
  /** Role from REASONING_MODEL_ROLES (e.g. 'planner', 'skeptic'). */
  role: string;
  /** Optional ModelCallPurpose. */
  callPurpose?: string;
  /**
   * Correlates primary + fallback emits from a single `callRoleModel`
   * invocation. Parallel invocations must use distinct ids (generated in
   * `callRoleModel`). Tests may pin this to assert duplicate-key paths.
   */
  telemetryInvocationId?: string;
  /**
   * Wall-clock ms when the call started. The orchestrator already
   * captures this via `Date.now()` at the top of `callRoleModel`; we
   * pass it through rather than recomputing so duration math stays
   * consistent.
   */
  startedAtMs: number;
}

/**
 * Fire-and-forget telemetry write. Returns immediately; the actual
 * INSERT happens in the background. Errors are swallowed and logged at
 * DEBUG (deploy-skew during migration rollout is a known-tolerable
 * state).
 *
 * @param result — the ModelCallResult returned by callRoleModel.
 * @param opts   — role, callPurpose, startedAtMs (orchestrator-side).
 */
export function emitCallTelemetry(result: ModelCallResult, opts: EmitOptions): void {
  // Capture scope synchronously so the async writer can't lose it if
  // the parent function returns and the AsyncLocalStorage context
  // unwinds before the INSERT completes.
  const scope = runScope.current() ?? {};
  const telemetryInvocationId = opts.telemetryInvocationId ?? randomUUID();
  const optsResolved: EmitOptions = { ...opts, telemetryInvocationId };

  // Build the row payload off-thread; the actual DB call is fire-and-forget.
  void writeRow(result, optsResolved, scope).catch((err) => {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      // Migration 030 not applied yet. Per rule 25 (I-6), this is a
      // known-tolerable rollout state — log at DEBUG so it doesn't
      // spam ERROR.
      logger.debug('cost-sidecar: agent_executions table missing (migration 030 pending)');
      return;
    }
    if (pgCode === '23505') {
      // Unique violation on idempotency_key. Means we already wrote
      // this exact call — expected when bullmq replays a job that
      // started but didn't ack. Silent success.
      logger.debug('cost-sidecar: duplicate emit (idempotency key collision — expected on retry)', {
        model: result.model,
        role: opts.role,
      });
      return;
    }
    // Anything else: log at WARN with enough context for an operator
    // to investigate, but DO NOT throw — the main pipeline must not
    // care that telemetry failed.
    logger.warn('cost-sidecar: emit failed', {
      err: err instanceof Error ? err.message : String(err),
      pgCode,
      model: result.model,
      role: opts.role,
      runId: scope.runId,
    });
  });
}

async function writeRow(
  result: ModelCallResult,
  opts: EmitOptions,
  scope: RunScopeContext
): Promise<void> {
  const price = await getModelPrice(result.model);
  const calculatedCost = computeCostUsd(result.promptTokens, result.completionTokens, price);
  const phase = scope.phaseOverride ?? rolePhaseFor(opts.role, opts.callPurpose);
  const callPurpose = opts.callPurpose ?? 'default';
  const telemetryInvocationId = opts.telemetryInvocationId ?? randomUUID();
  const idempotencyKey = computeIdempotencyKey({
    runId: scope.runId,
    agentRole: opts.role,
    callPurpose,
    startedAtMs: opts.startedAtMs,
    model: result.model,
    telemetryInvocationId,
  });

  // ON CONFLICT (idempotency_key) DO NOTHING — per rule 25 (I-4).
  // We use adminQuery (bypasses RLS) because agent_executions is
  // admin-only data per rule 25 (I-8).
  await adminQuery(
    `INSERT INTO agent_executions (
       run_id, report_id, user_id, org_id,
       agent_role, phase, call_purpose,
       model, used_fallback, primary_model, error_classification,
       input_tokens, output_tokens,
       duration_ms, started_at_ms, started_at,
       input_price_per_1m_usd, output_price_per_1m_usd, calculated_cost_usd,
       idempotency_key, metadata
     ) VALUES (
       $1, $2, $3, $4,
       $5, $6, $7,
       $8, $9, $10, $11,
       $12, $13,
       $14, $15, to_timestamp($15::double precision / 1000.0),
       $16, $17, $18,
       $19, $20::jsonb
     )
     ON CONFLICT (idempotency_key) DO NOTHING`,
    [
      scope.runId ?? null,
      scope.reportId ?? null,
      scope.userId ?? null,
      scope.orgId ?? null,
      opts.role,
      phase,
      callPurpose,
      result.model,
      result.usedFallback,
      result.primaryModel,
      result.errorClassification ?? null,
      result.promptTokens,
      result.completionTokens,
      result.durationMs,
      opts.startedAtMs,
      price.inputPricePer1mUsd,
      price.outputPricePer1mUsd,
      calculatedCost,
      idempotencyKey,
      JSON.stringify({
        // Anything else we want to grep on later — kept lean.
        primary_model: result.primaryModel,
      }),
    ]
  );
}

/**
 * After `research_runs.report_id` is set at completion, backfill
 * `agent_executions.report_id` for that run so admin rollups and
 * `distinct_reports` stay accurate. Fire-and-forget; deploy-skew safe.
 */
export function patchAgentExecutionsReportIdForRun(runId: string, reportId: string): void {
  void adminQuery(
    `UPDATE agent_executions SET report_id = $1::uuid WHERE run_id = $2::uuid`,
    [reportId, runId]
  ).catch((err) => {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.debug('cost-sidecar: skip report_id patch (migration 030 pending or column missing)', {
        runId,
        pgCode,
      });
      return;
    }
    logger.warn('cost-sidecar: report_id patch failed', {
      err: err instanceof Error ? err.message : String(err),
      pgCode,
      runId,
    });
  });
}
