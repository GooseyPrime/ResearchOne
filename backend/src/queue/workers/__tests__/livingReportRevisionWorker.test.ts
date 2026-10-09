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

    // Events are addressed to rooms; nothing may be sent to every socket.
    const emits: Array<{ rooms: string[]; event: string; payload: unknown }> = [];
    const mockIo = {
      to(rooms: string | string[]) {
        return {
          emit: (event: string, payload?: unknown) => {
            emits.push({ rooms: Array.isArray(rooms) ? rooms : [rooms], event, payload });
          },
        };
      },
      emit: vi.fn(),
    } as unknown as SocketIOServer;
    const ownerLookups = {
      runOwner: async () => null,
      ingestionJobOwner: async () => null,
      reportOwner: async (id: string) => (id === 'r1' ? 'user_owner' : null),
      atlasExportOwner: async () => null,
      sourceOwners: async () => [],
    };

    const job = {
      data: {
        monitorId: 'm1',
        reportId: 'r1',
        revisionRequestId: 'q1',
        webhookEventId: 'w1',
        triggeredBy: 'reverse_citation_watch' as const,
      },
    } as Job<import('../livingReportRevisionWorker').LivingReportRevisionJobData>;

    const out = await processLivingReportRevisionJob(job, mockIo, ownerLookups);

    expect(out.revisionId).toBe('rev-x');
    expect(createReportRevision).toHaveBeenCalled();
    expect(recordLivingRevisionOutcome).toHaveBeenCalledWith({
      monitorId: 'm1',
      revisionId: 'rev-x',
      webhookEventId: 'w1',
    });
    const completed = emits.find((e) => e.event === 'revision:completed');
    expect(completed?.rooms).toEqual(['job:revision:r1', 'job:r1']);
    expect(emits.find((e) => e.event === 'reports:updated')?.rooms).toEqual(['user:user_owner']);
    const living = emits.find((e) => e.event === 'living_report:revision_completed');
    expect(living?.rooms).toEqual(['user:user_owner']);
    expect(living?.payload).toEqual(
      expect.objectContaining({ reportId: 'r1', revisionId: 'rev-x', monitorId: 'm1' })
    );
    expect(mockIo.emit).not.toHaveBeenCalled();
  });
});
