import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
import { processLivingReportRevisionJob } from '../queue/workers/livingReportRevisionWorker';

vi.mock('../services/reasoning/reportRevisionService', () => ({
  createReportRevision: vi.fn().mockResolvedValue({
    revisionId: 'rev-1',
    revisedReportId: 'rep-new',
    changePlan: {},
  }),
}));

vi.mock('../services/monitoring/parallelMonitorService', async () => {
  const actual = await vi.importActual<typeof import('../services/monitoring/parallelMonitorService')>(
    '../services/monitoring/parallelMonitorService'
  );
  return {
    ...actual,
    recordLivingRevisionOutcome: vi.fn().mockResolvedValue(undefined),
  };
});

describe('revision_via_monitor uses PolicyOne revision pipeline text', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('passes MONITOR_REVISION_REQUEST to createReportRevision (same intake/planner path as manual revisions)', async () => {
    const { MONITOR_REVISION_REQUEST } = await import('../services/monitoring/parallelMonitorService');
    const { createReportRevision } = await import('../services/reasoning/reportRevisionService');
    const mockIo = {
      to: () => ({ emit: vi.fn() }),
      emit: vi.fn(),
    } as unknown as SocketIOServer;

    const job = {
      data: {
        monitorId: 'mon',
        reportId: 'rep',
        revisionRequestId: 'req',
        webhookEventId: 'wh',
        triggeredBy: 'parallel_monitor' as const,
      },
    } as Job<import('../queue/workers/livingReportRevisionWorker').LivingReportRevisionJobData>;

    await processLivingReportRevisionJob(job, mockIo);

    expect(createReportRevision).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'rep',
        requestText: MONITOR_REVISION_REQUEST,
        requestId: 'req',
        revisionTriggeredBy: 'parallel_monitor',
        initiatedBy: 'parallel_monitor',
        initiatedByType: 'system',
      })
    );
  });
});
