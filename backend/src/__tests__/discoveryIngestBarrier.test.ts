import { describe, it, expect, vi, beforeEach } from 'vitest';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../db/pool', () => ({ query: queryMock }));
vi.mock('../utils/sleep', () => ({ sleep: async () => {} }));

import {
  waitForDiscoveryIngestReadiness,
  DEFAULT_SUFFICIENT_READY_RATIO,
  MIN_JOBS_FOR_PARTIAL_RELEASE,
} from '../services/discovery/discoveryIngestBarrier';

/**
 * The barrier held every run until ALL discovery sources were queryable, or the
 * timeout expired — and then proceeded anyway. So one slow or permanently
 * failed source cost the full timeout to reach a decision already made.
 */

const sources = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ ingestionJobId: `job-${i + 1}`, ingested: true }));

const readyRow = (id: string) => ({
  id,
  status: 'completed',
  source_id: `source-${id}`,
  chunk_count: 4,
  embedding_count: 4,
});

const pendingRow = (id: string) => ({
  id,
  status: 'processing',
  source_id: null,
  chunk_count: 0,
  embedding_count: 0,
});

const failedRow = (id: string) => ({
  id,
  status: 'failed',
  source_id: null,
  chunk_count: 0,
  embedding_count: 0,
});

describe('waitForDiscoveryIngestReadiness', () => {
  beforeEach(() => queryMock.mockReset());

  it('reports no sources when nothing was ingested', async () => {
    const result = await waitForDiscoveryIngestReadiness({ sources: [], timeoutMs: 1000 });
    expect(result.status).toBe('no_sources_ingested');
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('releases immediately when every job is queryable', async () => {
    queryMock.mockResolvedValueOnce([1, 2, 3].map((n) => readyRow(`job-${n}`)));
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(3), timeoutMs: 60_000 });
    expect(result.status).toBe('ready');
    expect(result.readyCount).toBe(3);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('does not wait out the timeout on a terminally failed job', async () => {
    // The bug: a failed job never becomes queryable, but stayed in `pending`
    // and was polled every 3s until the deadline.
    queryMock.mockResolvedValueOnce([readyRow('job-1'), readyRow('job-2'), failedRow('job-3')]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(3), timeoutMs: 600_000 });
    expect(result.status).toBe('ready');
    expect(result.failedCount).toBe(1);
    expect(result.readyCount).toBe(2);
    expect(result.pendingCount).toBe(0);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('releases on sufficiency rather than holding for a straggler', async () => {
    queryMock.mockResolvedValueOnce([
      ...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => readyRow(`job-${n}`)),
      pendingRow('job-9'),
      pendingRow('job-10'),
    ]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(10), timeoutMs: 600_000 });
    expect(result.status).toBe('sufficient');
    expect(result.readyCount).toBe(8);
    expect(result.pendingCount).toBe(2);
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('keeps waiting when below the sufficiency threshold', async () => {
    queryMock
      .mockResolvedValueOnce([
        ...[1, 2, 3].map((n) => readyRow(`job-${n}`)),
        ...[4, 5, 6, 7, 8, 9, 10].map((n) => pendingRow(`job-${n}`)),
      ])
      .mockResolvedValueOnce([...[4, 5, 6, 7, 8].map((n) => readyRow(`job-${n}`))]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(10), timeoutMs: 600_000 });
    expect(result.status).toBe('sufficient');
    expect(result.readyCount).toBe(8);
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('requires every job below the partial-release floor', async () => {
    // With few jobs a proportion is meaningless — 2 of 3 is not "most".
    expect(MIN_JOBS_FOR_PARTIAL_RELEASE).toBeGreaterThan(3);
    queryMock
      .mockResolvedValueOnce([readyRow('job-1'), readyRow('job-2'), pendingRow('job-3')])
      .mockResolvedValueOnce([readyRow('job-3')]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(3), timeoutMs: 600_000 });
    expect(result.status).toBe('ready');
    expect(queryMock).toHaveBeenCalledTimes(2);
  });

  it('reports timeout with what it managed to get', async () => {
    queryMock.mockResolvedValue([
      readyRow('job-1'),
      ...[2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => pendingRow(`job-${n}`)),
    ]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(10), timeoutMs: 0 });
    expect(result.status).toBe('timeout');
    expect(result.readyCount).toBe(1);
    expect(result.pendingCount).toBe(9);
    expect(result.pendingJobIds).toHaveLength(9);
  });

  it('says no_sources_ingested when every job failed', async () => {
    // Resolved, but nothing usable came of it — not a success.
    queryMock.mockResolvedValueOnce([1, 2, 3].map((n) => failedRow(`job-${n}`)));
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(3), timeoutMs: 60_000 });
    expect(result.status).toBe('no_sources_ingested');
    expect(result.failedCount).toBe(3);
    expect(result.readyCount).toBe(0);
  });

  it('emits progress while waiting so the pause is observable', async () => {
    const seen: number[] = [];
    queryMock
      .mockResolvedValueOnce([...Array.from({ length: 10 }, (_, i) => pendingRow(`job-${i + 1}`))])
      .mockResolvedValueOnce([...[1, 2, 3, 4, 5, 6, 7, 8].map((n) => readyRow(`job-${n}`))]);
    await waitForDiscoveryIngestReadiness({
      sources: sources(10),
      timeoutMs: 600_000,
      onProgress: (state) => {
        seen.push(state.readyCount);
      },
    });
    expect(seen).toEqual([0]);
  });

  it('does not treat a partially embedded source as queryable', async () => {
    // Chunks exist but embeddings lag: retrieval would find nothing.
    queryMock.mockResolvedValue([
      { id: 'job-1', status: 'completed', source_id: 's1', chunk_count: 10, embedding_count: 3 },
    ]);
    const result = await waitForDiscoveryIngestReadiness({ sources: sources(1), timeoutMs: 0 });
    expect(result.status).toBe('timeout');
    expect(result.readyCount).toBe(0);
  });

  it('uses a proportion, not a latency, as its release rule', () => {
    // Deliberate: a latency threshold would be a guess without run data.
    expect(DEFAULT_SUFFICIENT_READY_RATIO).toBeGreaterThan(0);
    expect(DEFAULT_SUFFICIENT_READY_RATIO).toBeLessThanOrEqual(1);
  });
});
