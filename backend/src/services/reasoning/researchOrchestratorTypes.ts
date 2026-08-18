import type { PerRunModelOverrides } from '../runtimeModelStore';
import type { PlanPayload } from '../planning/planTypes';
import type { ResearchObjective } from './reasoningModelPolicy';

export interface CreditChargeContext {
  type: 'subscription' | 'wallet' | 'byok' | 'none';
  costCents: number;
  /** Wallet surcharges for run add-ons (may apply even when base report is subscription quota). */
  addonSurchargeCents?: number;
  holdId?: string;
  userId?: string;
  subscriptionQuotaToDecrement?: number;
}

export interface ResearchJobData {
  runId: string;
  query: string;
  supplemental?: string;
  filterTags?: string[];
  modelOverrides?: PerRunModelOverrides;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  /**
   * True when the caller explicitly supplied `researchObjective` on the request.
   *
   * The v2 route defaults the field to `GENERAL_EPISTEMIC_RESEARCH` so pricing
   * and persistence always have a value, but that happens before intent
   * classification runs. Without this flag the worker cannot tell a deliberate
   * "general epistemic research" choice from the route's placeholder, and every
   * run recorded the generic objective regardless of intent (WO-AA Phase 6).
   */
  researchObjectiveExplicit?: boolean;
  /** Optional total report length in words. Clamped server-side to a safe
   *  range; routed into the synthesizer's per-section budget directives. */
  targetWordCount?: number;
  requestedFormats?: string[];
  requestedMethodology?: string;
  /** Preferred export citation style (mla, apa, …) persisted on the run row. */
  citationStyle?: string;
  creditChargeContext?: CreditChargeContext;
  /** When true, Wave 5.1 plan gate (Stage 0.5) is skipped — set after user confirms. */
  skipPlanConfirmationGate?: boolean;
  /** Confirmed gate plan (merged with canonical profile on resume). Wave 5.2. */
  confirmedPlanPayload?: PlanPayload;
  /**
   * Resolved saved orchestration profile (Wave 5.4). Set at enqueue time from
   * `savedOrchestrationProfileId` so the worker does not re-hit the DB for access checks.
   */
  savedOrchestrationProfileSeed?: {
    baseIntent: string;
    customizations: unknown;
    profileName?: string;
  };
  /** Per-run wallet add-ons from POST /api/research (persisted on research_runs.selected_addons). */
  addons?: string[];
}

export interface ResearchProgress {
  stage: string;
  percent: number;
  message: string;
  runId: string;
  detail?: string;
  substep?: string;
  timestamp: string;
  model?: string;
  tokenUsage?: { prompt: number; completion: number };
  sourceCount?: number;
  chunkCount?: number;
  eventType?: 'progress' | 'run_started' | 'run_failed' | 'run_completed' | 'run_resumed' | 'run_aborted';
  retryable?: boolean;
  failureMeta?: Record<string, unknown>;
  /** Wave 5.1 plan gate — echoed on progress / sockets when a draft plan is ready. */
  planId?: string;
  intent?: string;
  confidence?: number;
  /** Wave 5.2 — active orchestration profile label for live UI. */
  profileDisplayName?: string;
}

export interface RunSummaryPayload {
  runId: string;
  status: string;
  /**
   * The quality gate that produced this outcome, when one did.
   *
   * `status` collapses every non-success to `failed`, which cannot distinguish
   * an incomplete deliverable from an unverifiable one from a crash. Present
   * only on runs that reached the gates.
   */
  gateStatus?: 'completed' | 'completed_degraded' | 'contract_failed' | 'verification_failed' | null;
  totalDurationMs: number;
  phaseDurations: Record<string, number>;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  retryCount: number;
  failedStage?: string | null;
  errorMessage?: string | null;
  failureMeta?: Record<string, unknown> | null;
  orchestratorHints?: string[];
  modelUsage: Array<{ role: string; model: string; promptTokens: number; completionTokens: number; durationMs: number }>;
}

export type ProgressCallback = (update: ResearchProgress) => void;

/**
 * Pipeline reached the end and produced a report row.
 *
 * "Reached the end" is not "succeeded": a run whose quality gates failed still
 * writes a report for review. Consumers MUST branch on `completedCleanly`
 * rather than treating this result as success — the worker previously emitted
 * `research:completed` for gate failures too, so the UI showed a success
 * notification and navigated to a report that had not passed its contract
 * (Codex P1 review, PR #212).
 */
export interface ResearchJobCompletedResult {
  runId: string;
  reportId: string;
  /** False when a quality gate failed; the report exists but is under review. */
  completedCleanly: boolean;
  /** The gate outcome, so a consumer can say WHICH gate failed. */
  gateStatus?: 'completed' | 'completed_degraded' | 'contract_failed' | 'verification_failed' | null;
  summary?: RunSummaryPayload;
}

/** Wave 5.1: run parked after Stage 0.5 until the user confirms the plan. */
export interface ResearchJobParkedAtPlanGateResult {
  outcome: 'parked_at_plan_gate';
  runId: string;
  planId: string;
  planPayload: PlanPayload;
  refinementRounds: number;
}

export type ResearchJobResult = ResearchJobCompletedResult | ResearchJobParkedAtPlanGateResult;

export function isResearchJobParkedAtPlanGate(
  r: ResearchJobResult
): r is ResearchJobParkedAtPlanGateResult {
  return 'outcome' in r && r.outcome === 'parked_at_plan_gate';
}
