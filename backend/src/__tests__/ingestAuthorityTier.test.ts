/**
 * Slice 6. The tier is written at ingest only with AUTHORITY_TIERS_ENABLED on.
 * With the switch off no statement names the column, so stored rows are what
 * they were before the switch existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORED_ID = '99999999-9999-4999-8999-999999999999';
const NEW_ID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, stored: true, failTier: false }));

const record = (sql: string, params: unknown[] = []) => {
  h.queries.push({ sql, params });
  if (h.failTier && /authority_tier/.test(sql)) throw Object.assign(new Error('column "authority_tier" does not exist'), { code: '42703' });
};

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    record(sql, params);
    return [];
  }),
  queryOne: vi.fn(async (sql: string) => (h.stored && sql.includes('FROM sources WHERE content_hash') ? { id: STORED_ID } : null)),
  withTransaction: vi.fn(async (work: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }) => Promise<void>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        record(sql, params);
        return { rows: [{ id: NEW_ID }] };
      },
    })
  ),
}));
vi.mock('../queue/queues', () => ({ embeddingQueue: { add: vi.fn() }, ingestionQueue: { add: vi.fn() } }));

import { runWithFlags } from '../config/runFlags';
import { recordAuthorityTier, runIngestionJob } from '../services/ingestion/ingestionService';

const job = () =>
  runIngestionJob(
    {
      ingestionJobId: 'job-1',
      sourceType: 'text',
      text: 'Costs rose after 1979 in the United States.',
      metadata: { bibliographic: { authors: ['Lovering, Jessica R.'], kind: 'journal article', provider: 'crossref' } },
    } as Parameters<typeof runIngestionJob>[0],
    () => undefined
  );

const tierWrites = () => h.queries.filter((entry) => /authority_tier/.test(entry.sql));
const on = <T,>(work: () => T) => runWithFlags({ AUTHORITY_TIERS_ENABLED: true }, work);

describe('recording a source\'s authority tier at ingest', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.stored = true;
    h.failTier = false;
    delete process.env.AUTHORITY_TIERS_ENABLED;
  });
  afterEach(() => {
    delete process.env.AUTHORITY_TIERS_ENABLED;
  });

  it('writes nothing about tiers with the switch off', async () => {
    await job();
    h.stored = false;
    await job();
    expect(tierWrites()).toHaveLength(0);
    // The statement that stores a new source is the one it always was.
    const insert = h.queries.find((entry) => /INSERT INTO sources/.test(entry.sql));
    expect(insert?.sql).not.toContain('authority_tier');
    expect(insert?.params).toHaveLength(19);
  });

  it('records the tier of a new source with the switch on', async () => {
    h.stored = false;
    await on(job);
    expect(tierWrites()).toHaveLength(1);
    expect(tierWrites()[0].params).toEqual([NEW_ID, 2]);
    // Still not part of the statement that stores the source.
    expect(h.queries.find((entry) => /INSERT INTO sources/.test(entry.sql))?.sql).not.toContain('authority_tier');
  });

  it('reads the process setting when no run recorded one', async () => {
    process.env.AUTHORITY_TIERS_ENABLED = 'true';
    h.stored = false;
    await job();
    expect(tierWrites()).toHaveLength(1);
  });

  it('gives a stored source a tier without replacing one it has', async () => {
    await on(job);
    expect(tierWrites()).toHaveLength(1);
    expect(tierWrites()[0].sql).toContain('COALESCE(authority_tier, $2::smallint)');
    expect(tierWrites()[0].params).toEqual([STORED_ID, 2]);
  });

  it('finishes the job when the column is not there yet', async () => {
    h.failTier = true;
    h.stored = false;
    await expect(on(job)).resolves.toMatchObject({ sourceId: NEW_ID });
    expect(h.queries.filter((entry) => /SET status='failed'/.test(entry.sql))).toHaveLength(0);
  });

  it('writes nothing for a source with nothing to judge by', async () => {
    await on(() => recordAuthorityTier(STORED_ID, { url: '' }));
    expect(tierWrites()).toHaveLength(0);
    await on(() => recordAuthorityTier(STORED_ID, { url: 'https://www.nrc.gov/x' }));
    expect(tierWrites()[0].params).toEqual([STORED_ID, 1]);
  });
});
