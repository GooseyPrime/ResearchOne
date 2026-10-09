import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from './redis';
import { QUEUE_NAMES } from './queues';
import { logger } from '../utils/logger';
import { runIngestionJob } from '../services/ingestion/ingestionService';
import { runEmbeddingJob } from '../services/embedding/embeddingService';
import {
  runResearchJob,
  resumeAfterPlanConfirmation,
  isResearchJobParkedAtPlanGate,
  type RunSummaryPayload,
} from '../services/reasoning/researchOrchestrator';
import {
  RESEARCH_JOB_RESUME_AFTER_PLAN,
  researchStartedNotice,
  type ResearchResumeAfterPlanJobData,
} from './researchQueueJobs';
import { runAtlasExport } from '../services/embedding/atlasExport';
import { query } from '../db/pool';
import { getLatestRunCheckpoint } from '../services/reasoning/checkpointService';
import { ResearchCancelledError } from '../services/researchCancellation';
import {
  classifyResearchFailureForSocket,
  isBenignPlanResumeAwaitingConfirm,
} from '../utils/researchFailureRouting';
import { createResearchWorker } from './createResearchWorker';
import { createPrivateEmitter } from '../realtime/privateEmit';

async function markInterruptedResearchRuns(): Promise<void> {
  const rows = await query<{ id: string }>(`SELECT id FROM research_runs WHERE status='running' ORDER BY created_at DESC LIMIT 1000`);
  for (const row of rows) {
    const latestCheckpoint = await getLatestRunCheckpoint(row.id);
    await query(
      `UPDATE research_runs
       SET status='failed',
           error_message='Run interrupted by restart before completion',
           failed_stage=COALESCE($2, 'unknown'),
           failure_meta=$3,
           completed_at=NOW()
       WHERE id=$1`,
      [
        row.id,
        latestCheckpoint?.stage ?? null,
        JSON.stringify({
          reason: 'interrupted_by_restart',
          latestCheckpoint: latestCheckpoint?.checkpoint_key ?? null,
        }),
      ]
    );
  }
  if (rows.length > 0) {
    logger.warn(`Marked ${rows.length} orphaned running runs as interrupted_by_restart`);
  }
}

export async function startWorkers(io: SocketIOServer): Promise<void> {
  await markInterruptedResearchRuns();
  // Every event goes to the run's own room and its owner's room only —
  // nothing is sent to all connected pages (see realtime/privateEmit.ts).
  const live = createPrivateEmitter(io);
  const emitRun = (runId: string, event: string, data: unknown): void => {
    void live.toRun(runId, event, data);
  };
  const emitIngestion = (jobId: string, event: string, data: unknown): void => {
    void live.toIngestionJob(jobId, event, data);
  };
  const runListsChanged = (runId: string, withReports: boolean): void => {
    if (withReports) void live.notifyRunOwner(runId, 'reports:updated', {});
    void live.notifyRunOwner(runId, 'runs:updated', {});
  };

  // ─── Ingestion Worker ─────────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.INGESTION,
    async (job: Job) => {
      logger.info(`Ingestion job started: ${job.id}`);
      emitIngestion(job.data.ingestionJobId, 'job:progress', { status: 'running', jobId: job.data.ingestionJobId });
      const result = await runIngestionJob(job.data, (progress) => {
        job.updateProgress(progress);
        emitIngestion(job.data.ingestionJobId, 'job:progress', progress);
      });
      void live.notifyIngestionJobOwner(job.data.ingestionJobId, 'corpus:updated', {});
      emitIngestion(job.data.ingestionJobId, 'job:completed', result);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 3 }
  );

  // ─── Embedding Worker ─────────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.EMBEDDING,
    async (job: Job) => {
      logger.info(`Embedding job started: ${job.id}`);
      const result = await runEmbeddingJob(job.data, (progress) => {
        job.updateProgress(progress);
      });
      void live.notifySourceOwners((job.data as { sourceId: string }).sourceId, 'corpus:updated', {});
      return result;
    },
    { connection: createRedisConnection(), concurrency: 2 }
  );

  // ─── Research Worker ─────────────────────────────────────────────────
  createResearchWorker(
    async (job: Job) => {
      if (job.name === RESEARCH_JOB_RESUME_AFTER_PLAN) {
        const data = job.data as ResearchResumeAfterPlanJobData;
        const { runId, confirmedPlanId } = data;
        logger.info(`Research resume-after-plan job started: ${job.id}`);
        emitRun(runId, 'research:progress', researchStartedNotice(runId));
        try {
          const result = await resumeAfterPlanConfirmation(runId, confirmedPlanId, (update) => {
            job.updateProgress(update);
            emitRun(runId, 'research:progress', update);
          });
          if (isResearchJobParkedAtPlanGate(result)) {
            emitRun(result.runId, 'research:plan_ready_for_confirmation', {
              runId: result.runId,
              planId: result.planId,
              planPayload: result.planPayload,
              refinementRounds: result.refinementRounds,
            });
            runListsChanged(result.runId, false);
            return result;
          }
          // A gate failure produces a report row but is NOT a completion. Sent
          // as `research:completed`, the UI showed a success notification and
          // navigated to a report that had not passed its contract, before the
          // corrected summary arrived (Codex P1 review, PR #212).
          emitRun(
            runId,
            result.completedCleanly ? 'research:completed' : 'research:quality_gate_failed',
            result
          );
          if (result.summary) {
            emitRun(runId, 'run:summary', result.summary);
          }
          runListsChanged(runId, true);
          return result;
        } catch (err) {
          if (err instanceof ResearchCancelledError) {
            emitRun(runId, 'research:cancelled', { runId });
            const cancelledSummary = (err as Error & { summary?: RunSummaryPayload }).summary;
            if (cancelledSummary) {
              emitRun(runId, 'run:summary', cancelledSummary);
            }
            runListsChanged(runId, false);
            return { cancelled: true, runId };
          }
          const e = err as Error & {
            runId?: string;
            stage?: string;
            percent?: number;
            message?: string;
            retryable?: boolean;
            code?: string;
            failureMeta?: Record<string, unknown>;
            summary?: RunSummaryPayload;
          };
          if (isBenignPlanResumeAwaitingConfirm(e)) {
            logger.info('plan_resume_awaiting_confirm', {
              runId,
              confirmedPlanId,
              message: e.message,
            });
            throw err;
          }
          const decision = classifyResearchFailureForSocket(e, runId);
          emitRun(runId, decision.event, decision.payload);
          if (e.summary) {
            emitRun(runId, 'run:summary', e.summary);
          }
          runListsChanged(runId, true);
          throw err;
        }
      }

      logger.info(`Research job started: ${job.id}`);
      emitRun(job.data.runId, 'research:progress', researchStartedNotice(job.data.runId));
      try {
        const result = await runResearchJob(job.data, (update) => {
          job.updateProgress(update);
          emitRun(job.data.runId, 'research:progress', update);
        });
        if (isResearchJobParkedAtPlanGate(result)) {
          emitRun(result.runId, 'research:plan_ready_for_confirmation', {
            runId: result.runId,
            planId: result.planId,
            planPayload: result.planPayload,
            refinementRounds: result.refinementRounds,
          });
          runListsChanged(result.runId, false);
          return result;
        }
        // Same branch as the primary worker: a gate failure is not a completion.
        emitRun(
          job.data.runId,
          result.completedCleanly ? 'research:completed' : 'research:quality_gate_failed',
          result
        );
        if (result.summary) {
          emitRun(job.data.runId, 'run:summary', result.summary);
        }
        runListsChanged(job.data.runId, true);
        return result;
      } catch (err) {
        if (err instanceof ResearchCancelledError) {
          emitRun(job.data.runId, 'research:cancelled', { runId: job.data.runId });
          const cancelledSummary = (err as Error & { summary?: RunSummaryPayload }).summary;
          if (cancelledSummary) {
            emitRun(job.data.runId, 'run:summary', cancelledSummary);
          }
          runListsChanged(job.data.runId, false);
          return { cancelled: true, runId: job.data.runId };
        }
        const e = err as Error & {
          runId?: string;
          stage?: string;
          percent?: number;
          message?: string;
          retryable?: boolean;
          failureMeta?: Record<string, unknown>;
          summary?: RunSummaryPayload;
        };
        // Differentiate aborted (no retries remain) from failed (retryable);
        // the frontend listens for both events and shows distinct status.
        // The orchestrator throws a *budget-finalized* error shape so this
        // socket event matches the DB row that was just written.
        const decision = classifyResearchFailureForSocket(e, job.data.runId);
        emitRun(job.data.runId, decision.event, decision.payload);
        if (e.summary) {
          emitRun(job.data.runId, 'run:summary', e.summary);
        }
        runListsChanged(job.data.runId, true);
        throw err;
      }
    },
    createRedisConnection(),
  );

  // ─── Atlas Export Worker ──────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.ATLAS_EXPORT,
    async (job: Job) => {
      logger.info(`Atlas export job started: ${job.id}`);
      const result = await runAtlasExport(job.data);
      void live.notifyAtlasExportOwner((job.data as { exportId: string }).exportId, 'atlas:updated', result);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  // ─── Pipeline B Ingestion Worker ─────────────────────────────────────
  const { startPipelineBWorker } = await import('./workers/pipelineBIngestion');
  startPipelineBWorker(io);

  // ─── InTellMe Deletion Worker ──────────────────────────────────────
  const { startDeletionWorker } = await import('./workers/intellmeDeletion');
  startDeletionWorker(io);

  const { startLivingReportRevisionWorker } = await import('./workers/livingReportRevisionWorker');
  startLivingReportRevisionWorker(io);

  const { startReportExportWorker } = await import('./workers/reportExportWorker');
  startReportExportWorker(io);

  logger.info('All BullMQ workers started');
}
