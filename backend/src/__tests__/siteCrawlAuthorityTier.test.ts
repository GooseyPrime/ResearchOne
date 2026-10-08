/**
 * Slice 6. A site crawl catches each page's failure so one bad page does not
 * end the crawl. A page that was stored but whose authority tier could not be
 * written is different: counted as one lost page, the crawl would finish and
 * the stored page would never get its tier. That failure ends the crawl, so the
 * retry records it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ queries: [] as Array<{ sql: string; params: unknown[] }>, failTier: false, sourceN: 0 }));

const record = (sql: string, params: unknown[] = []) => {
  h.queries.push({ sql, params });
  if (h.failTier && /authority_tier/.test(sql)) throw Object.assign(new Error('permission denied for table sources'), { code: '42501' });
};

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    record(sql, params);
    return [];
  }),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(async (work: (client: { query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<{ id: string }> }> }) => Promise<void>) =>
    work({
      query: async (sql: string, params: unknown[] = []) => {
        record(sql, params);
        h.sourceN += 1;
        return { rows: [{ id: `00000000-0000-4000-8000-${String(h.sourceN).padStart(12, '0')}` }] };
      },
    })
  ),
}));
vi.mock('../queue/queues', () => ({ embeddingQueue: { add: vi.fn() }, ingestionQueue: { add: vi.fn() } }));
vi.mock('../services/ingestion/siteCrawl', () => ({
  discoverSiteCrawlUrls: vi.fn(async () => ['https://www.nrc.gov/a', 'https://www.nrc.gov/b']),
}));
vi.mock('../services/ingestion/urlFetchPolicy', () => ({
  assertPublicHttpUrl: (url: string) => new URL(url),
  UrlFetchPolicyError: class extends Error {},
}));
vi.mock('axios', () => {
  const get = vi.fn(async (url: string) => ({
    headers: { 'content-type': 'text/html' },
    data: Buffer.from(`<html><head><title>Page ${url}</title></head><body><p>Reactor licensing text for ${url}, long enough to keep.</p></body></html>`),
  }));
  return { default: { get, head: get, post: vi.fn(), create: () => ({ get }) } };
});

import { AuthorityTierWriteError, runIngestionJob } from '../services/ingestion/ingestionService';

const crawl = () =>
  runIngestionJob(
    { ingestionJobId: 'job-1', sourceType: 'web_url', url: 'https://www.nrc.gov/a', siteCrawl: true, crawlLayers: 2, importedVia: 'manual_url' } as Parameters<typeof runIngestionJob>[0],
    () => undefined
  );

describe('a site crawl and the authority tier', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.failTier = false;
    h.sourceN = 0;
    process.env.AUTHORITY_TIERS_ENABLED = 'true';
  });
  afterEach(() => {
    delete process.env.AUTHORITY_TIERS_ENABLED;
  });

  it('records a tier for each page', async () => {
    await crawl();
    expect(h.queries.filter((entry) => /authority_tier/.test(entry.sql)).map((entry) => entry.params[1])).toEqual([1, 1]);
  });

  it('ends the crawl when a stored page\'s tier cannot be written', async () => {
    h.failTier = true;
    await expect(crawl()).rejects.toBeInstanceOf(AuthorityTierWriteError);
    // It stopped at the first page; it was not counted as one lost page among others.
    expect(h.queries.filter((entry) => /authority_tier/.test(entry.sql))).toHaveLength(1);
  });
});
