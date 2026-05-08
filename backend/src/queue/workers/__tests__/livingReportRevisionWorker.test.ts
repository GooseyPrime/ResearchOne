import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Job } from 'bullmq';
import type { Server as SocketIOServer } from 'socket.io';
import { processLivingReportRevisionJob } from '../livingReportRevisionWorker';

vi.mock('../../../services/reasoning/reportRevisionService', () => ({
  createReportRevision: vi.fn().mockResolvedValue({
    revisionId: 'rev-x',
    revisedReportId: 'rep-y',
    changePlan: { sections: [] },
  }),
}));

vi.mock('../../../services/monitoring/parallelMonitorService', async () => {
  const actual = await vi.importActual<typeof import('../../../services/monitoring/parallelMonitorService')>(
    '../../../services/monitoring/parallelMonitorService'
  );
  return {
    ...actual,
    recordLivingRevisionOutcome: vi.fn().mockResolvedValue(undefined),
  };
});

describe('livingReportRevisionWorker', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records outcome and emits revision socket channels after success', async () => {
    const { recordLivingRevisionOutcome } = await import('../../../services/monitoring/parallelMonitorService');
    const { createReportRevision } = await import('../../../services/reasoning/reportRevisionService');

    const emits: Array<{ room: string; event: string }> = [];
    const mockIo = {
      to(room: string) {
        return {
          emit: (event: string, _payload?: unknown) => {
            emits.push({ room, event });
          },
        };
      },
      emit: vi.fn(),
    } as unknown as SocketIOServer;

    const job = {
      data: {
        monitorId: 'm1',
        reportId: 'r1',
        revisionRequestId: 'q1',
        webhookEventId: 'w1',
        triggeredBy: 'reverse_citation_watch' as const,
      },
    } as Job<import('../livingReportRevisionWorker').LivingReportRevisionJobData>;

    const out = await processLivingReportRevisionJob(job, mockIo);

    expect(out.revisionId).toBe('rev-x');
    expect(createReportRevision).toHaveBeenCalled();
    expect(recordLivingRevisionOutcome).toHaveBeenCalledWith({
      monitorId: 'm1',
      revisionId: 'rev-x',
      webhookEventId: 'w1',
    });
    expect(emits.some((e) => e.room === 'job:r1' && e.event === 'revision:completed')).toBe(true);
    expect(emits.some((e) => e.room === 'reports' && e.event === 'reports:updated')).toBe(true);
    expect(mockIo.emit).toHaveBeenCalledWith(
      'living_report:revision_completed',
      expect.objectContaining({ reportId: 'r1', revisionId: 'rev-x', monitorId: 'm1' })
    );
  });
});
