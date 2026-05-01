import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from './redis';
import { QUEUE_NAMES } from './queues';
import { logger } from '../utils/logger';
import { runIngestionJob } from '../services/ingestion/ingestionService';
import { runEmbeddingJob } from '../services/embedding/embeddingService';
import { runResearchJob, type RunSummaryPayload } from '../services/reasoning/researchOrchestrator';
import { runAtlasExport } from '../services/embedding/atlasExport';
import { query } from '../db/pool';
import { getLatestRunCheckpoint } from '../services/reasoning/checkpointService';
import { ResearchCancelledError } from '../services/researchCancellation';
import { classifyResearchFailureForSocket } from '../utils/researchFailureRouting';

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
  const emit = (room: string, event: string, data: unknown) => {
    io.to(room).emit(event, data);
    io.emit(event, data); // also broadcast to all for dashboard updates
  };

  // ─── Ingestion Worker ─────────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.INGESTION,
    async (job: Job) => {
      logger.info(`Ingestion job started: ${job.id}`);
      emit(`job:${job.data.ingestionJobId}`, 'job:progress', { status: 'running', jobId: job.data.ingestionJobId });
      const result = await runIngestionJob(job.data, (progress) => {
        job.updateProgress(progress);
        emit(`job:${job.data.ingestionJobId}`, 'job:progress', progress);
      });
      emit('corpus', 'corpus:updated', {});
      emit(`job:${job.data.ingestionJobId}`, 'job:completed', result);
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
      emit('corpus', 'corpus:updated', {});
      return result;
    },
    { connection: createRedisConnection(), concurrency: 2 }
  );

  // ─── Research Worker ─────────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.RESEARCH,
    async (job: Job) => {
      logger.info(`Research job started: ${job.id}`);
      emit(`job:${job.data.runId}`, 'research:progress', { stage: 'started', runId: job.data.runId });
      try {
        const result = await runResearchJob(job.data, (update) => {
          job.updateProgress(update);
          emit(`job:${job.data.runId}`, 'research:progress', update);
        });
        emit(`job:${job.data.runId}`, 'research:completed', result);
        if (result.summary) {
          emit(`job:${job.data.runId}`, 'run:summary', result.summary);
        }
        io.emit('reports:updated', {});
        io.emit('runs:updated', {});
        return result;
      } catch (err) {
        if (err instanceof ResearchCancelledError) {
          emit(`job:${job.data.runId}`, 'research:cancelled', { runId: job.data.runId });
          const cancelledSummary = (err as Error & { summary?: RunSummaryPayload }).summary;
          if (cancelledSummary) {
            emit(`job:${job.data.runId}`, 'run:summary', cancelledSummary);
          }
          io.emit('runs:updated', {});
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
        emit(`job:${job.data.runId}`, decision.event, decision.payload);
        if (e.summary) {
          emit(`job:${job.data.runId}`, 'run:summary', e.summary);
        }
        io.emit('reports:updated', {});
        io.emit('runs:updated', {});
        throw err;
      }
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  // ─── Atlas Export Worker ──────────────────────────────────────────────
  new Worker(
    QUEUE_NAMES.ATLAS_EXPORT,
    async (job: Job) => {
      logger.info(`Atlas export job started: ${job.id}`);
      const result = await runAtlasExport(job.data);
      io.emit('atlas:updated', result);
      return result;
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  logger.info('All BullMQ workers started');
}
