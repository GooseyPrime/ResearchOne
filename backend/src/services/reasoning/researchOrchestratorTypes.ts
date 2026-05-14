import type { PerRunModelOverrides } from '../runtimeModelStore';
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
