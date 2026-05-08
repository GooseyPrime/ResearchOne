import { Worker, Job } from 'bullmq';
import { Server as SocketIOServer } from 'socket.io';
import { createRedisConnection } from '../redis';
import { QUEUE_NAMES } from '../queues';
import { logger } from '../../utils/logger';
import { createReportRevision, type RevisionTriggerSource } from '../../services/reasoning/reportRevisionService';
import {
  MONITOR_REVISION_REQUEST,
  recordLivingRevisionOutcome,
  recordLivingRevisionJobFailed,
} from '../../services/monitoring/parallelMonitorService';

export interface LivingReportRevisionJobData {
  monitorId: string;
  reportId: string;
  revisionRequestId: string;
  webhookEventId: string;
  triggeredBy: RevisionTriggerSource;
}

/** Exported for tests — runs the same PolicyOne revision pipeline as user-initiated revisions. */
export async function processLivingReportRevisionJob(
  job: Job<LivingReportRevisionJobData>,
  io: SocketIOServer
): Promise<{ revisionId: string; revisedReportId: string }> {
  const { reportId, revisionRequestId, webhookEventId, monitorId, triggeredBy } = job.data;

  const emitProgress = (payload: unknown) => {
    io.to(`job:revision:${reportId}`).emit('revision:progress', payload);
    io.to(`job:${reportId}`).emit('revision:progress', payload);
    io.to('reports').emit('revision:progress', payload);
  };

  const result = await createReportRevision({
    reportId,
    requestText: MONITOR_REVISION_REQUEST,
    rationale: 'Automatic revision triggered by Parallel Monitor webhook.',
    initiatedBy: 'parallel_monitor',
    initiatedByType: 'system',
    revisionTriggeredBy: triggeredBy,
    requestId: revisionRequestId,
    onProgress: emitProgress,
  });

  await recordLivingRevisionOutcome({
    monitorId,
    revisionId: result.revisionId,
    webhookEventId,
  });

  io.to(`job:revision:${reportId}`).emit('revision:completed', result);
  io.to(`job:${reportId}`).emit('revision:completed', result);
  io.to('reports').emit('reports:updated', {});
  io.emit('living_report:revision_completed', {
    reportId,
    revisionId: result.revisionId,
    monitorId,
  });

  return { revisionId: result.revisionId, revisedReportId: result.revisedReportId };
}

export function startLivingReportRevisionWorker(io: SocketIOServer): Worker {
  const worker = new Worker(
    QUEUE_NAMES.LIVING_REPORT_REVISION,
    async (job: Job<LivingReportRevisionJobData>) => {
      logger.info('living_report_revision_job_start', { jobId: job.id, reportId: job.data.reportId });
      return processLivingReportRevisionJob(job, io);
    },
    { connection: createRedisConnection(), concurrency: 1 }
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const max = typeof job.opts.attempts === 'number' ? job.opts.attempts : 3;
    if ((job.attemptsMade ?? 0) < max) return;

    const data = job.data as LivingReportRevisionJobData;
    logger.error('living_report_revision_job_failed_final', {
      jobId: job.id,
      reportId: data.reportId,
      error: err instanceof Error ? err.message : String(err),
    });

    recordLivingRevisionJobFailed({
      monitorId: data.monitorId,
      revisionRequestId: data.revisionRequestId,
      webhookEventId: data.webhookEventId,
      errorMessage: err instanceof Error ? err.message : String(err),
    }).catch((dbErr) => {
      logger.error('living_revision_record_failure_write_failed', {
        monitorId: data.monitorId,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
    });
  });

  return worker;
}
