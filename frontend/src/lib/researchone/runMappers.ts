/**
 * Maps Emma API research run rows to Sticklight UI display types.
 */

import type { ResearchRun as ApiResearchRun } from '../../utils/api';
import type {
  EvidenceTier,
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
  sleuth: 'discovery',
  quantitative: 'retriever',
  formatter: 'report',
  retriever: 'retriever',
  retriever_analysis: 'retriever_analysis',
  reasoner: 'reasoner',
  skeptic: 'skeptic',
  synthesizer: 'synthesizer',
  verifier: 'verifier',
  report: 'report',
  formatting: 'report',
  complete: 'complete',
  completed: 'complete',
};

export function mapApiRunStatus(status: string): RunStatus {
  return STATUS_MAP[status] ?? 'running';
}

export function mapApiRunStage(stage?: string | null): ResearchStage {
  if (!stage) return 'planner';
  const key = stage.toLowerCase();
  return STAGE_MAP[key] ?? 'reasoner';
}

export function mapApiRunToVaultRun(run: ApiResearchRun): VaultResearchRun {
  return {
    id: run.id,
    query: run.query || run.title || 'Untitled research',
    mode: 'standard',
    status: mapApiRunStatus(run.status),
    currentStage: mapApiRunStage(run.progress_stage),
    progress: run.progress_percent ?? 0,
    sourcesRetrieved: 0,
    contradictionsDetected: 0,
    evidenceTier: 'supported' as EvidenceTier,
    createdAt: run.created_at ?? run.started_at ?? new Date().toISOString(),
    updatedAt: run.progress_updated_at ?? run.completed_at ?? run.created_at,
    completedAt: run.completed_at ?? undefined,
    error: run.error_message ?? undefined,
  };
}

export function isInFlightApiStatus(status: string): boolean {
  return status === 'queued' || status === 'running' || status === 'plan_pending_confirmation';
}
