/**
 * Maps Emma API research run rows to Sticklight UI display types.
 */

import type { ResearchRun as ApiResearchRun } from '../../utils/api';
import type {
  ResearchRun as VaultResearchRun,
  ResearchStage,
  RunStatus,
} from './types';

const STATUS_MAP: Record<string, RunStatus> = {
  queued: 'queued',
  running: 'running',
  plan_pending_confirmation: 'running',
  completed: 'complete',
  failed: 'failed',
  cancelled: 'cancelled',
  aborted: 'cancelled',
};

const STAGE_MAP: Record<string, ResearchStage> = {
  planning: 'planner',
  planner: 'planner',
  discovery: 'discovery',
  sleuth: 'sleuth',
  quantitative: 'quantitative',
  formatter: 'formatter',
  retriever: 'retriever',
  retriever_analysis: 'retriever_analysis',
  retriever_assessor: 'retriever',
  reasoner: 'reasoner',
  skeptic: 'skeptic',
  synthesizer: 'synthesizer',
  verifier: 'verifier',
  report: 'formatter',
  formatting: 'formatter',
  plan_pending_confirmation: 'planner',
  complete: 'formatter',
  completed: 'formatter',
};

export function mapApiRunStatus(status: string): RunStatus {
  return STATUS_MAP[status] ?? 'running';
}

export function mapApiRunStage(stage?: string | null): ResearchStage {
  if (!stage) return 'planner';
  const key = stage.toLowerCase();
  return STAGE_MAP[key] ?? 'reasoner';
}

/**
 * Map an API run row to the UI's run type, carrying only what the row says.
 *
 * This used to hardcode `sourcesRetrieved: 0`, `contradictionsDetected: 0` and
 * `evidenceTier: 'supported'` because the type demanded them and the row does
 * not have them. Run `f1e74c06` was observed in production rendering "Source
 * corroboration tier: SUPPORTED" while queued at 0% with zero sources.
 *
 * `mode` went the same way: it said `'standard'` on every run, and after
 * WO-AH there is no mode to report at all.
 *
 * The fields are optional now. Absent means unknown, and unknown renders as
 * nothing rather than as a reassuring default.
 */
export function mapApiRunToVaultRun(run: ApiResearchRun): VaultResearchRun {
  return {
    id: run.id,
    query: run.query || run.title || 'Untitled research',
    status: mapApiRunStatus(run.status),
    currentStage: mapApiRunStage(run.progress_stage),
    progress: run.progress_percent ?? 0,
    createdAt: run.created_at ?? run.started_at ?? new Date().toISOString(),
    updatedAt: run.progress_updated_at ?? run.completed_at ?? run.created_at,
    completedAt: run.completed_at ?? undefined,
    error: run.error_message ?? undefined,
  };
}

export function isInFlightApiStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'plan_pending_confirmation';
}
