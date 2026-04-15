import { Queue } from 'bullmq';
import { createRedisConnection } from './redis';

export const QUEUE_NAMES = {
  INGESTION: 'ingestion',
  EMBEDDING: 'embedding',
  RESEARCH: 'research',
  ATLAS_EXPORT: 'atlas-export',
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

export const researchQueue = new Queue(QUEUE_NAMES.RESEARCH, {
  connection,
  defaultJobOptions: {
    attempts: 2,
    backoff: { type: 'exponential', delay: 10000 },
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
