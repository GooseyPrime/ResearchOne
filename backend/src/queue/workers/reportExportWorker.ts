/**
 * Report export worker — drains the report_export BullMQ queue.
 *
 * Job payload (set by reports.ts:POST /:id/export):
 *   {
 *     exportId: string,
 *     reportId: string,
 *     format: 'docx' | 'pdf' | 'md' | 'html',
 *     style: 'mla' | 'apa' | ...,
 *     userId: string | null,
 *   }
 *
 * Lifecycle:
 *   1. UPDATE report_exports SET status='running', started_at=NOW().
 *   2. Call exportReport(...) — handles pandoc + tempdir + cleanup.
 *   3. Persist the output buffer (S3 / local) and store output_url.
 *   4. UPDATE status='completed' (or 'failed' / 'timed_out').
 *
 * Status writes are best-effort but their absence is observable —
 * the GET polling endpoint will keep returning 'running' if a worker
 * crashed mid-job. A future WO can add a stale-export reaper that
 * marks 'running' jobs older than N minutes as 'timed_out'.
 */
import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from '../redis';
import { QUEUE_NAMES } from '../queues';
import { adminQuery } from '../../db/pool';
import { exportReport } from '../../services/formatting/exportOrchestrator';
import { PandocError, type ExportFormat, type ExportStyle } from '../../services/formatting/pandocRunner';
import { uploadExportOutput } from '../../services/formatting/exportStorage';
import { logger } from '../../utils/logger';

interface ExportJobData {
  exportId: string;
  reportId: string;
  format: ExportFormat;
  style: ExportStyle;
  userId: string | null;
}

export function startReportExportWorker(_io: SocketIOServer): Worker {
  const worker = new Worker<ExportJobData>(
    QUEUE_NAMES.REPORT_EXPORT,
    async (job: Job<ExportJobData>) => {
      const { exportId, reportId, format, style, userId } = job.data;

      await adminQuery(
        `UPDATE report_exports
            SET status='running', started_at=NOW()
          WHERE id = $1`,
        [exportId]
      );

      try {
        const result = await exportReport({ reportId, format, style, userId });

        const outputUrl = await uploadExportOutput({
          exportId,
          reportId,
          format,
          buffer: result.outputBuffer,
        });

        await adminQuery(
          `UPDATE report_exports
              SET status='completed',
                  output_url=$1,
                  output_bytes=$2,
                  pandoc_duration_ms=$3,
                  completed_at=NOW()
            WHERE id=$4`,
          [outputUrl, result.outputBytes, result.pandocDurationMs, exportId]
        );

        return { exportId, outputUrl, outputBytes: result.outputBytes };
      } catch (err) {
        const errClass = err instanceof PandocError ? err.classification : 'pandoc_error';
        const errDetail = err instanceof Error ? err.message : String(err);

        await adminQuery(
          `UPDATE report_exports
              SET status=$1,
                  error_class=$2,
                  error_detail=$3,
                  completed_at=NOW()
            WHERE id=$4`,
          [
            errClass === 'timeout' ? 'timed_out' : 'failed',
            errClass,
            errDetail.slice(0, 2000),
            exportId,
          ]
        );

        logger.warn('export worker: job failed', {
          exportId,
          reportId,
          errClass,
          errDetail: errDetail.slice(0, 200),
        });
        throw err;
      }
    },
    {
      connection: createRedisConnection(),
      lockDuration: 90_000,
      concurrency: 2,
    }
  );

  worker.on('failed', (job, err) => {
    logger.error('export worker: job ultimately failed after retries', {
      jobId: job?.id,
      exportId: job?.data?.exportId,
      err: err.message,
    });
  });

  worker.on('completed', (job) => {
    logger.info('export worker: job completed', {
      jobId: job.id,
      exportId: job.data.exportId,
    });
  });

  return worker;
}
