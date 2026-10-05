/**
 * A source whose content is already stored, ingested again by a run that
 * carries reference details. The details are optional: when they cannot be
 * written the job must still finish and be linked to the stored source, as it
 * did before reference details existed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const STORED_ID = '99999999-9999-4999-8999-999999999999';
const h = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, failFill: false }));

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    h.queries.push({ sql, params });
    if (h.failFill && /UPDATE sources\s+SET authors/.test(sql)) throw new Error('connection lost');
    return [];
  }),
  queryOne: vi.fn(async (sql: string) => (sql.includes('FROM sources WHERE content_hash') ? { id: STORED_ID } : null)),
  withTransaction: vi.fn(),
}));
vi.mock('../queue/queues', () => ({ embeddingQueue: { add: vi.fn() }, ingestionQueue: { add: vi.fn() } }));

import { runIngestionJob } from '../services/ingestion/ingestionService';

const job = () =>
  runIngestionJob(
    {
      ingestionJobId: 'job-1',
      sourceType: 'text',
      text: 'Costs rose after 1979 in the United States.',
      metadata: { bibliographic: { authors: ['Lovering, Jessica R.'], publisher: 'Energy Policy', publishedAt: '2016-04-01', provider: 'crossref' } },
    } as Parameters<typeof runIngestionJob>[0],
    () => undefined
  );

const ran = (pattern: RegExp) => h.queries.filter((entry) => pattern.test(entry.sql));

describe('ingesting content that is already stored, with reference details', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.failFill = false;
  });

  it('fills the stored source and completes the job', async () => {
    await expect(job()).resolves.toEqual({ sourceId: STORED_ID, chunkCount: 0 });
    const fill = ran(/UPDATE sources\s+SET authors/);
    expect(fill).toHaveLength(1);
    expect(fill[0].params.slice(0, 4)).toEqual([STORED_ID, ['Lovering, Jessica R.'], 'Energy Policy', '2016-04-01']);
    expect(ran(/SET status='completed'/)).toHaveLength(1);
  });

  it('still links and completes the job when the details cannot be written', async () => {
    h.failFill = true;
    await expect(job()).resolves.toEqual({ sourceId: STORED_ID, chunkCount: 0 });
    expect(ran(/UPDATE ingestion_jobs SET source_id=/)[0].params).toEqual([STORED_ID, 'job-1']);
    expect(ran(/SET status='completed'/)).toHaveLength(1);
    expect(ran(/SET status='failed'/)).toHaveLength(0);
  });
});
