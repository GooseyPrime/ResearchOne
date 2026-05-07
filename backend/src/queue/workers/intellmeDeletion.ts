import { Worker, Job } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from '../redis';
import { QUEUE_NAMES } from '../queues';
import { intellmeClient } from '../../services/ingestion/index';
import { writeAuditLog } from '../../services/ingestion/auditLogger';
import { logger } from '../../utils/logger';

export interface DeletionJobData {
  runId: string;
  userId: string;
  documentId: string;
}

export function startDeletionWorker(_io: SocketIOServer): Worker {
  const worker = new Worker<DeletionJobData>(
    QUEUE_NAMES.INTELLME_DELETION,
    async (job: Job<DeletionJobData>) => {
      const { runId, userId, documentId } = job.data;

      await writeAuditLog(runId, userId, 'deletion_requested', { documentId });

      try {
        await intellmeClient.delete({ userId, documentId });
        await writeAuditLog(runId, userId, 'deletion_completed', { documentId });
      } catch (err) {
        await writeAuditLog(runId, userId, 'deletion_error', {
          message: err instanceof Error ? err.message : 'Unknown',
        });
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 2,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('intellme_deletion_job_failed', {
      jobId: job?.id,
      runId: job?.data?.runId,
      error: err.message,
    });
  });

  return worker;
}
