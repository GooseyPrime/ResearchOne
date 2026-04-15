import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from './redis';
import { QUEUE_NAMES } from './queues';
import { logger } from '../utils/logger';
import { runIngestionJob } from '../services/ingestion/ingestionService';
import { runEmbeddingJob } from '../services/embedding/embeddingService';
import { runResearchJob } from '../services/reasoning/researchOrchestrator';
import { runAtlasExport } from '../services/embedding/atlasExport';

export async function startWorkers(io: SocketIOServer): Promise<void> {
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
      const result = await runResearchJob(job.data, (update) => {
        job.updateProgress(update);
        emit(`job:${job.data.runId}`, 'research:progress', update);
      });
      emit(`job:${job.data.runId}`, 'research:completed', result);
      io.emit('reports:updated', {});
      return result;
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
