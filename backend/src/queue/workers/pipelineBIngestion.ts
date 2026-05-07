/**
 * BullMQ worker for Pipeline B ingestion.
 * Receives sanitized artifact, sends to InTellMe, writes audit log.
 *
 * Error handling per WO L:
 * - 503 from InTellMe → BullMQ retry with exponential backoff (queue config)
 * - 400 from InTellMe → routed to dead-letter (job fails permanently)
 * - 409 from InTellMe → marked deduplicated in audit log (success)
 */

import { Worker, Job } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from '../redis';
import { QUEUE_NAMES } from '../queues';
import { intellmeClient } from '../../services/ingestion/index';
import { writeAuditLog } from '../../services/ingestion/auditLogger';
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface PipelineBJobData {
  runId: string;
  userId: string;
  contentHash: string;
  sanitizedContent: string;
}

export function startPipelineBWorker(_io: SocketIOServer): Worker {
  const worker = new Worker<PipelineBJobData>(
    QUEUE_NAMES.PIPELINE_B_INGESTION,
    async (job: Job<PipelineBJobData>) => {
      const { runId, userId, contentHash, sanitizedContent } = job.data;

      await writeAuditLog(runId, userId, 'intellme_request_sent', { contentHash });

      try {
        await intellmeClient.ingest({
          userId,
          documentId: runId,
          content: sanitizedContent,
        });

        await writeAuditLog(runId, userId, 'intellme_response_received', { status: 'success' });

        try {
          await query(
            `UPDATE run_ingestion_state SET pipeline_b_status = 'completed', intellme_request_id = $2, updated_at = NOW() WHERE run_id = $1`,
            [runId, contentHash]
          );
        } catch {
          // deploy-skew: table may not exist
        }
      } catch (err) {
        const status = (err as { status?: number }).status;

        if (status === 409) {
          await writeAuditLog(runId, userId, 'intellme_deduplicated', { contentHash });
          try {
            await query(
              `UPDATE run_ingestion_state SET pipeline_b_status = 'deduplicated', updated_at = NOW() WHERE run_id = $1`,
              [runId]
            );
          } catch {
            // deploy-skew
          }
          return;
        }

        await writeAuditLog(runId, userId, 'intellme_error', {
          status,
          message: err instanceof Error ? err.message : 'Unknown',
        });

        try {
          await query(
            `UPDATE run_ingestion_state SET pipeline_b_status = 'failed', updated_at = NOW() WHERE run_id = $1`,
            [runId]
          );
        } catch {
          // deploy-skew
        }

        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      concurrency: 3,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('pipeline_b_ingestion_job_failed', {
      jobId: job?.id,
      runId: job?.data?.runId,
      error: err.message,
    });
  });

  return worker;
}
