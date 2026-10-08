/**
 * Slice 6. The tier is written at ingest only with AUTHORITY_TIERS_ENABLED on.
 * With the switch off no statement names the column, so stored rows are what
 * they were before the switch existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const STORED_ID = '99999999-9999-4999-8999-999999999999';
const NEW_ID = '11111111-1111-4111-8111-111111111111';
const h = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, stored: true, storedUrl: null as string | null, failTier: '' as '' | '42703' | 'other' }));

const record = (sql: string, params: unknown[] = []) => {
  h.queries.push({ sql, params });
  if (h.failTier === '42703' && /authority_tier/.test(sql)) throw Object.assign(new Error('column "authority_tier" does not exist'), { code: '42703' });
  if (h.failTier === 'other' && /authority_tier/.test(sql)) throw Object.assign(new Error('permission denied for table sources'), { code: '42501' });
};

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    record(sql, params);
    return [];
  }),
  queryOne: vi.fn(async (sql: string) => (h.stored && sql.includes('FROM sources WHERE content_hash') ? { id: STORED_ID, url: h.storedUrl } : null)),
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
import { recordAuthorityTier, runIngestionJob, tierForIngest, tierForStoredDuplicate } from '../services/ingestion/ingestionService';

const job = (extra: Record<string, unknown> = {}) =>
  runIngestionJob(
    {
      ingestionJobId: 'job-1',
      sourceType: 'text',
      text: 'Costs rose after 1979 in the United States.',
      metadata: { bibliographic: { authors: ['Lovering, Jessica R.'], kind: 'journal article', provider: 'crossref' } },
      // A job discovery queued: the provider's record is trusted.
      importedVia: 'autonomous_discovery',
      ...extra,
    } as Parameters<typeof runIngestionJob>[0],
    () => undefined
  );

const tierWrites = () => h.queries.filter((entry) => /authority_tier/.test(entry.sql));
const on = <T,>(work: () => T) => runWithFlags({ AUTHORITY_TIERS_ENABLED: true }, work);

describe('recording a source\'s authority tier at ingest', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.stored = true;
    h.failTier = '';
    h.storedUrl = null;
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

  it('gives a stored source the tier of its own address, without replacing one it has', async () => {
    // This job read the same text with no address; the stored source was read at a regulator's site.
    h.storedUrl = 'https://www.nrc.gov/reactors/x.html';
    await on(job);
    expect(tierWrites()).toHaveLength(1);
    expect(tierWrites()[0].sql).toContain('COALESCE(authority_tier, $2::smallint)');
    expect(tierWrites()[0].params).toEqual([STORED_ID, 1]);
  });

  it('finishes the job when the column is not there yet', async () => {
    h.failTier = '42703';
    h.stored = false;
    await expect(on(job)).resolves.toMatchObject({ sourceId: NEW_ID });
    expect(h.queries.filter((entry) => /SET status='failed'/.test(entry.sql))).toHaveLength(0);
  });

  it('fails the job on any other failure, after everything else is stored, so a retry records the tier', async () => {
    h.failTier = 'other';
    h.stored = false;
    await expect(on(job)).rejects.toThrow('permission denied');
    // The passages were stored and queued before the tier was written.
    const order = h.queries.map((entry) => entry.sql);
    const lastChunk = order.map((sql, at) => (/INSERT INTO chunks/.test(sql) ? at : -1)).reduce((a, b) => Math.max(a, b), -1);
    const tierAt = order.findIndex((sql) => /authority_tier/.test(sql));
    expect(lastChunk).toBeGreaterThan(-1);
    expect(tierAt).toBeGreaterThan(lastChunk);
  });

  it('a person\'s upload cannot raise its own tier', async () => {
    h.stored = false;
    // Metadata a person sent claims a journal article from a catalogue, and a carried tier.
    await on(() => job({ importedVia: 'manual_upload', authorityTier: 1 }));
    expect(tierWrites()).toHaveLength(0);
    const sent = { kind: 'journal article', provider: 'crossref', url: 'https://someones-blog.example.com/x' };
    expect(on(() => tierForIngest({ importedVia: 'manual_url', authorityTier: 1 }, sent))).toBe(4);
    expect(on(() => tierForIngest({ importedVia: 'autonomous_discovery' }, sent))).toBe(2);
  });

  it('judges a stored duplicate by where the stored copy was read', () => {
    const job = { importedVia: 'autonomous_discovery' as const, authorityTier: 2 };
    // Same address: this job's tier stands.
    expect(tierForStoredDuplicate(job, { url: 'https://doi.org/10.1/x' }, 'https://doi.org/10.1/x')).toBe(2);
    // Discovery's idea of the same address: a trailing slash, a fragment or the host's case do not change it.
    expect(tierForStoredDuplicate(job, { url: 'https://Host.example.org/x' }, 'https://host.example.org/x/')).toBe(2);
    expect(tierForStoredDuplicate(job, { url: 'https://host.example.org/x#section-2' }, 'https://host.example.org/x')).toBe(2);
    // Another address: the carried tier is about this job's copy, not the stored one.
    expect(tierForStoredDuplicate(job, { url: 'https://www.nature.com/x' }, 'https://copy.example.com/x')).toBeNull();
    expect(on(() => tierForStoredDuplicate(job, { url: 'https://www.nature.com/x' }, 'https://copy.example.com/x'))).toBe(4);
    expect(on(() => tierForStoredDuplicate(job, { url: 'https://www.nature.com/x' }, null))).toBeNull();
  });

  it('records the tier a discovery job carries, with no switch on in this worker', async () => {
    // A run's switches do not reach the ingestion worker; the job brings the tier.
    h.stored = false;
    await job({ authorityTier: 1, metadata: {} });
    expect(tierWrites()).toHaveLength(1);
    expect(tierWrites()[0].params).toEqual([NEW_ID, 1]);
  });

  it('ignores a carried value that is not a tier', async () => {
    h.stored = false;
    await job({ authorityTier: 9, metadata: {} });
    expect(tierWrites()).toHaveLength(0);
  });

  it('judges a job that carries no tier only with the switch on, and writes nothing for a source with nothing to judge by', async () => {
    expect(tierForIngest({}, { url: 'https://www.nrc.gov/x' })).toBeNull();
    expect(on(() => tierForIngest({}, { url: 'https://www.nrc.gov/x' }))).toBe(1);
    expect(on(() => tierForIngest({}, { url: '' }))).toBeNull();
    expect(tierForIngest({ importedVia: 'autonomous_discovery', authorityTier: 3 }, { url: 'https://www.nrc.gov/x' })).toBe(3);
    await recordAuthorityTier(STORED_ID, null);
    expect(tierWrites()).toHaveLength(0);
  });
});
