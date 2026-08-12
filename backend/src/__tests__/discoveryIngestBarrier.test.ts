import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, sleepMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  sleepMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: queryMock,
}));

vi.mock('../utils/sleep', () => ({
  sleep: sleepMock,
}));

import { waitForDiscoveryIngestReadiness } from '../services/discovery/discoveryIngestBarrier';

describe('waitForDiscoveryIngestReadiness', () => {
  beforeEach(() => {
    queryMock.mockReset();
    sleepMock.mockReset();
    sleepMock.mockResolvedValue(undefined);
  });

  it('waits until discovery sources are chunked and embedded before resolving', async () => {
    queryMock
      .mockResolvedValueOnce([
        { id: 'job-1', status: 'completed', source_id: 'source-1', chunk_count: 2, embedding_count: 1 },
      ])
      .mockResolvedValueOnce([
        { id: 'job-1', status: 'completed', source_id: 'source-1', chunk_count: 2, embedding_count: 2 },
      ]);

    const result = await waitForDiscoveryIngestReadiness({
      sources: [{ ingestionJobId: 'job-1', ingested: true }] as Array<{ ingestionJobId?: string; ingested: boolean }>,
      timeoutMs: 10_000,
    });

    expect(queryMock).toHaveBeenCalledTimes(2);
    expect(result.status).toBe('ready');
    expect(result.readyCount).toBe(1);
  });

  it('times out, proceeds, and records the shortfall when sources are not queryable in time', async () => {
    queryMock.mockResolvedValue([
      { id: 'job-1', status: 'completed', source_id: 'source-1', chunk_count: 3, embedding_count: 1 },
    ]);

    const result = await waitForDiscoveryIngestReadiness({
      sources: [{ ingestionJobId: 'job-1', ingested: true }] as Array<{ ingestionJobId?: string; ingested: boolean }>,
      timeoutMs: 0,
    });

    expect(result.status).toBe('timeout');
    expect(result.pendingCount).toBe(1);
    expect(result.pendingJobIds).toEqual(['job-1']);
  });

  it('emits a loud no-sources-ingested status when discovery produced zero ingested sources', async () => {
    const onStatus = vi.fn();

    const result = await waitForDiscoveryIngestReadiness({
      sources: [] as Array<{ ingestionJobId?: string; ingested: boolean }>,
      timeoutMs: 10_000,
      onStatus,
    });

    expect(result.status).toBe('no_sources_ingested');
    expect(onStatus).toHaveBeenCalledWith(expect.objectContaining({ status: 'no_sources_ingested' }));
    expect(queryMock).not.toHaveBeenCalled();
  });
});
