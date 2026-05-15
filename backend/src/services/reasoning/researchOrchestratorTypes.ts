import type { PerRunModelOverrides } from '../runtimeModelStore';
import type { PlanPayload } from '../planning/planTypes';
import type { ResearchObjective } from './reasoningModelPolicy';

export interface CreditChargeContext {
  type: 'subscription' | 'wallet' | 'byok' | 'none';
  costCents: number;
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
  /** Optional total report length in words. Clamped server-side to a safe
   *  range; routed into the synthesizer's per-section budget directives. */
  targetWordCount?: number;
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

/** Successful pipeline completion (report created). */
export interface ResearchJobCompletedResult {
  runId: string;
  reportId: string;
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
