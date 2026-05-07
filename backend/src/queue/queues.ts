import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const QUEUE_NAMES = {
  INGESTION: 'ingestion',
  EMBEDDING: 'embedding',
  RESEARCH: 'research',
  ATLAS_EXPORT: 'atlas-export',
  PIPELINE_B_INGESTION: 'pipeline-b-ingestion',
  INTELLME_DELETION: 'intellme-deletion',
} as const;

const connection = createRedisConnection();

export const ingestionQueue = new Queue(QUEUE_NAMES.INGESTION, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

export const embeddingQueue = new Queue(QUEUE_NAMES.EMBEDDING, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 3000 },
    removeOnComplete: 100,
    removeOnFail: 200,
  },
});

/**
 * Research queue: each job is a single research-run attempt. Application-level
 * retry-from-failure is the only retry path for research, so we set
 * `attempts: 1`. If a worker throws, the job is failed immediately and the run
 * row goes terminal — no silent BullMQ-level reprocessing that would reset
 * `progress_stage` and confuse the UI.
 */
export const researchQueue = new Queue(QUEUE_NAMES.RESEARCH, {
  connection,
  defaultJobOptions: {
    attempts: 1,
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const pipelineBIngestionQueue = new Queue(QUEUE_NAMES.PIPELINE_B_INGESTION, {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
});

export const intellmeDeletionQueue = new Queue(QUEUE_NAMES.INTELLME_DELETION, {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 5000 },
    removeOnComplete: 50,
    removeOnFail: 100,
  },
});

export const atlasExportQueue = new Queue(QUEUE_NAMES.ATLAS_EXPORT, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'fixed', delay: 5000 },
    removeOnComplete: 20,
    removeOnFail: 50,
  },
});
