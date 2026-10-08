/**
 * Slice 6, part 2. Layer 1 retrieval orders passages by relevance first, then
 * by the authority tier of their source. With the switch off the order is
 * relevance alone, as it always was. No passage is ever dropped for its tier.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, generateEmbeddingsMock } = vi.hoisted(() => ({ queryMock: vi.fn(), generateEmbeddingsMock: vi.fn() }));

vi.mock('../db/pool', () => ({ query: queryMock }));
vi.mock('../services/openrouter/openrouterService', async () => {
  const actual = await vi.importActual<typeof import('../services/openrouter/openrouterService')>('../services/openrouter/openrouterService');
  return { ...actual, generateEmbeddings: generateEmbeddingsMock };
});

import { runWithFlags } from '../config/runFlags';
import { retrieveChunksWithAudit } from '../services/retrieval/retrievalService';
import { orderByRelevanceThenAuthority, tierOfStoredSource } from '../services/authority/authorityTier';

const DOMAINS = ['alpha.example.com', 'beta.example.org', 'gamma.example.net', 'delta.example.io', 'epsilon.example.dev', 'zeta.example.co', 'eta.example.ai', 'theta.example.app'];
const SOURCE_STATS = DOMAINS.flatMap((name, d) =>
  Array.from({ length: 4 }, (_, i) => ({
    source_id: `source-${d}-${i}`,
    source_url: `https://${name.split('.')[0]}${i}.${name.split('.').slice(1).join('.')}/article`,
    tags: ['partition:market.affiliate'],
    published_at: '2026-07-01T00:00:00.000Z',
    ingested_at: '2026-07-02T00:00:00.000Z',
    owner_user_id: null,
    partition_key: 'market.affiliate',
    chunk_count: 20,
  }))
);

const hit = (id: string, url: string, similarity: number): Record<string, unknown> & { id: string; source_url: string } => ({
  id,
  content: `Passage ${id}`,
  chunk_index: 0,
  source_url: url,
  source_title: id,
  tags: ['partition:market.affiliate'],
  similarity,
  evidence_tier: null,
  owner_user_id: null,
  imported_via: 'autonomous_discovery',
});

// The blog is retrieved first and is a hair more relevant: the same relevance to two places.
const HITS = [
  hit('blog', 'https://someones-blog.example.com/post', 0.8312),
  hit('regulator', 'https://www.nrc.gov/reactors/x.html', 0.8291),
  hit('lower', 'https://www.nrc.gov/other.html', 0.7),
];

const state = { tierColumn: true as boolean, tierReadFails: false, hits: HITS };

function answer() {
  queryMock.mockImplementation(async (sql: string) => {
    if (sql.includes('partition_key') && sql.includes('chunk_count')) return SOURCE_STATS;
    if (sql.includes('COUNT(DISTINCT s.id)::int AS total_sources')) return [{ total_sources: SOURCE_STATS.length + 10, total_chunks: 1400 }];
    if (sql.includes('FROM embeddings e')) return state.hits;
    if (sql.includes('FROM chunks c') && sql.includes('JOIN sources s')) {
      if (state.tierReadFails) throw new Error('connection lost');
      if (sql.includes('authority_tier') && !state.tierColumn) throw Object.assign(new Error('column "authority_tier" does not exist'), { code: '42703' });
      return state.hits.map((h) => ({ chunk_id: h.id, url: h.source_url }));
    }
    return [];
  });
}

const retrieve = () =>
  retrieveChunksWithAudit({ query: 'reactor licensing', intentId: 'opportunity_discovery', userId: 'user-1', hybridSearch: false });
const order = async (flags: Record<string, boolean>) => (await runWithFlags(flags, retrieve)).citableChunks.map((chunk) => chunk.id);

describe('Layer 1 retrieval order', () => {
  beforeEach(() => {
    queryMock.mockReset();
    generateEmbeddingsMock.mockReset();
    generateEmbeddingsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    state.tierColumn = true;
    state.tierReadFails = false;
    state.hits = HITS;
    answer();
  });
  afterEach(() => vi.restoreAllMocks());

  it('is relevance alone with the switch off, and reads no tiers', async () => {
    expect(await order({})).toEqual(['blog', 'regulator', 'lower']);
    expect(queryMock.mock.calls.some(([sql]) => String(sql).includes('authority_tier'))).toBe(false);
  });

  it('puts the higher tier first between two equally relevant passages', async () => {
    expect(await order({ AUTHORITY_TIERS_ENABLED: true })).toEqual(['regulator', 'blog', 'lower']);
  });

  it('never puts a less relevant passage ahead for its tier, and drops nothing', async () => {
    const ids = await order({ AUTHORITY_TIERS_ENABLED: true });
    expect(ids[ids.length - 1]).toBe('lower');
    expect(ids).toHaveLength(3);
  });

  it('works out tiers when the column is not there yet', async () => {
    state.tierColumn = false;
    expect(await order({ AUTHORITY_TIERS_ENABLED: true })).toEqual(['regulator', 'blog', 'lower']);
  });

  it('takes the citable passages after the independence check, so a set-aside one takes no citable place', async () => {
    // The requester's own supplied government page is as relevant as the blog and ranks above it.
    const own = { ...hit('own-upload', 'https://www.energy.gov/mine', 0.8305), owner_user_id: 'user-1', imported_via: 'manual_url' };
    state.hits = [HITS[0], own, HITS[1], HITS[2]];
    const audit = (topK: number) =>
      runWithFlags({ AUTHORITY_TIERS_ENABLED: true }, () =>
        retrieveChunksWithAudit({ query: 'reactor licensing', intentId: 'opportunity_discovery', userId: 'user-1', hybridSearch: false, topK })
      );
    const result = await audit(2);
    // Two citable passages, as asked; the supplied page is kept as background.
    expect(result.citableChunks.map((chunk) => chunk.id)).toEqual(['regulator', 'blog']);
    expect(result.backgroundChunks.map((chunk) => chunk.id)).toEqual(['own-upload']);
  });

  it('falls back to relevance when the tiers cannot be read', async () => {
    state.tierReadFails = true;
    expect(await order({ AUTHORITY_TIERS_ENABLED: true })).toEqual(['blog', 'regulator', 'lower']);
  });
});

describe('ordering and stored tiers', () => {
  const c = (id: string, similarity: number, authority_tier: 1 | 2 | 3 | 4 | null) => ({ id, similarity, authority_tier });

  it('orders within a relevance band by tier, unranked last, then by relevance', () => {
    const out = orderByRelevanceThenAuthority([c('a', 0.904, null), c('b', 0.901, 4), c('c', 0.899, 2), c('d', 0.95, 4), c('e', 0.8, 1)]);
    expect(out.map((x) => x.id)).toEqual(['d', 'c', 'b', 'a', 'e']);
  });

  it('a tier 4 source that is the only one stays', () => {
    expect(orderByRelevanceThenAuthority([c('only', 0.6, 4)]).map((x) => x.id)).toEqual(['only']);
  });

  it('reads the recorded tier first, then judges by the address alone', () => {
    expect(tierOfStoredSource({ authority_tier: 3, url: 'https://www.nrc.gov/x' })).toBe(3);
    expect(tierOfStoredSource({ url: 'https://www.nrc.gov/x' })).toBe(1);
    // A stored kind is never read: a later upload of the same content may have filled it in.
    expect(tierOfStoredSource({ url: 'https://doi.org/10.1/x', ...({ kind: 'journal article' } as object) })).toBe(3);
    expect(tierOfStoredSource({ url: null })).toBeNull();
  });
});
