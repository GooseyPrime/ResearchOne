import { beforeEach, describe, expect, it, vi } from 'vitest';

const { queryMock, generateEmbeddingsMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  generateEmbeddingsMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({
  query: queryMock,
}));

vi.mock('../services/openrouter/openrouterService', async () => {
  const actual = await vi.importActual<typeof import('../services/openrouter/openrouterService')>(
    '../services/openrouter/openrouterService'
  );
  return {
    ...actual,
    generateEmbeddings: generateEmbeddingsMock,
  };
});

import { retrieveChunksWithAudit } from '../services/retrieval/retrievalService';
import { resolveCorpusPartition } from '../services/retrieval/corpusCompetenceGate';

describe('corpus partition defaults are subject-neutral', () => {
  // The intent map is a LAST RESORT. It must describe the kind of work, never a
  // subject: five report types were once pinned to `market.affiliate`, borrowed
  // from whichever request happened to be under development. Because Rule 40
  // unlocks per partition, that would have let one subject's sources unseal
  // every unrelated subject filed alongside it.
  const INTENTS = [
    'opportunity_discovery',
    'comparative',
    'feasibility',
    'recommendation',
    'exploratory',
    'implementation',
    'how_to',
    'factual_report',
    'literature_review',
    'survey',
    'timeline',
    'reference_lookup',
    'adjudication',
    'investigation',
    'story_verification',
    'position_brief',
  ] as const;

  it('never defaults any report type to a subject-specific partition', () => {
    for (const intentId of INTENTS) {
      const partition = resolveCorpusPartition({ intentId: intentId as never });
      expect(partition).toMatch(/^[a-z_]+\.general$/);
    }
  });

  it('lets tags and source records carry the subject instead', () => {
    // Explicit tags win over the intent default — this is where subject belongs.
    expect(
      resolveCorpusPartition({
        intentId: 'opportunity_discovery' as never,
        filterTags: ['partition:market.affiliate'],
      })
    ).toBe('market.affiliate');
    expect(
      resolveCorpusPartition({
        intentId: 'opportunity_discovery' as never,
        sourceRecords: [{ partitionKey: 'medical.devices' } as never],
      })
    ).toBe('medical.devices');
  });
});

function makeSourceStat(index: number, domain: string, chunkCount = 20) {
  return {
    source_id: `source-${index}`,
    source_url: `https://${domain}/article-${index}`,
    tags: ['partition:market.affiliate'],
    published_at: '2026-07-01T00:00:00.000Z',
    ingested_at: '2026-07-02T00:00:00.000Z',
    owner_user_id: null,
    partition_key: 'market.affiliate',
    chunk_count: chunkCount,
  };
}

describe('retrieveChunksWithAudit corpus competence gate', () => {
  beforeEach(() => {
    queryMock.mockReset();
    generateEmbeddingsMock.mockReset();
    generateEmbeddingsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
  });

  it('returns zero citable chunks and sealed corpusGate metadata for a sealed partition', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT') && sql.includes('partition_key') && sql.includes('chunk_count')) {
        return [
          {
            source_id: 'source-a',
            source_url: 'https://notes.example.com/a',
            tags: ['partition:market.affiliate'],
            published_at: '2026-07-01T00:00:00.000Z',
            ingested_at: '2026-07-01T00:00:00.000Z',
            owner_user_id: 'user-1',
            partition_key: 'market.affiliate',
            chunk_count: 30,
          },
          {
            source_id: 'source-b',
            source_url: 'https://notes.example.com/b',
            tags: ['partition:market.affiliate'],
            published_at: '2026-07-02T00:00:00.000Z',
            ingested_at: '2026-07-02T00:00:00.000Z',
            owner_user_id: 'user-1',
            partition_key: 'market.affiliate',
            chunk_count: 30,
          },
        ];
      }
      if (sql.includes('COUNT(DISTINCT s.id)::int AS total_sources')) {
        return [{ total_sources: 2, total_chunks: 60 }];
      }
      return [];
    });

    const result = await retrieveChunksWithAudit({
      query: 'affiliate comparison opportunities',
      intentId: 'opportunity_discovery',
      userId: 'user-1',
      hybridSearch: false,
    });

    expect(result.citableChunks).toEqual([]);
    expect(result.corpusGate.status).toBe('sealed');
    // 0.55, not 0.30. This assertion was lowered alongside the production
    // default in #224, which left the regression suite green against the exact
    // value that previously let the operator's own project notes be cited as
    // external evidence (AGENTS.md:207-210). A regression test that accepts the
    // known-bad value protects nothing. (Codex, #224 second pass.)
    expect(result.corpusGate.minSimilarity).toBeGreaterThanOrEqual(0.55);
    expect(result.corpusGate.reason).toContain('single_domain_share');
    expect(generateEmbeddingsMock).not.toHaveBeenCalled();
  });

  it('retrieves normally when the partition is unsealed', async () => {
    const sourceStats = [
      ...Array.from({ length: 4 }, (_, i) => makeSourceStat(i + 1, `alpha${i}.example.com`)),
      ...Array.from({ length: 4 }, (_, i) => makeSourceStat(i + 5, `beta${i}.example.org`)),
      ...Array.from({ length: 4 }, (_, i) => makeSourceStat(i + 9, `gamma${i}.example.net`)),
      ...Array.from({ length: 4 }, (_, i) => makeSourceStat(i + 13, `delta${i}.example.io`)),
      ...Array.from({ length: 3 }, (_, i) => makeSourceStat(i + 17, `epsilon${i}.example.dev`)),
      ...Array.from({ length: 3 }, (_, i) => makeSourceStat(i + 20, `zeta${i}.example.co`)),
      ...Array.from({ length: 4 }, (_, i) => makeSourceStat(i + 23, `eta${i}.example.ai`)),
      ...Array.from({ length: 3 }, (_, i) => makeSourceStat(i + 27, `theta${i}.example.app`)),
    ];

    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT') && sql.includes('partition_key') && sql.includes('chunk_count')) {
        return sourceStats;
      }
      if (sql.includes('COUNT(DISTINCT s.id)::int AS total_sources')) {
        return [{ total_sources: sourceStats.length + 10, total_chunks: 1400 }];
      }
      if (sql.includes('FROM embeddings e')) {
        return [
          {
            id: 'chunk-1',
            content: 'Independent affiliate market evidence',
            chunk_index: 0,
            source_url: 'https://alpha0.example.com/article-1',
            source_title: 'Independent source',
            tags: ['partition:market.affiliate'],
            similarity: 0.91,
            evidence_tier: 'strong_evidence',
            owner_user_id: null,
          },
        ];
      }
      return [];
    });

    const result = await retrieveChunksWithAudit({
      query: 'affiliate comparison opportunities',
      intentId: 'opportunity_discovery',
      userId: 'user-1',
      hybridSearch: false,
    });

    expect(result.corpusGate.status).toBe('unsealed');
    expect(result.citableChunks).toHaveLength(1);
    expect(result.corpusGate.citableChunks).toBe(1);
  });

  it('seals the reference incident corpus shape with only first-party docs and no independent domains', async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('SELECT') && sql.includes('partition_key') && sql.includes('chunk_count')) {
        return [
          {
            source_id: 'source-a',
            source_url: 'https://workspace.local/project-notes',
            tags: ['partition:market.affiliate'],
            published_at: '2026-07-01T00:00:00.000Z',
            ingested_at: '2026-07-01T00:00:00.000Z',
            owner_user_id: 'user-1',
            partition_key: 'market.affiliate',
            chunk_count: 220,
          },
          {
            source_id: 'source-b',
            source_url: 'https://workspace.local/shopify-validation',
            tags: ['partition:market.affiliate'],
            published_at: '2026-07-02T00:00:00.000Z',
            ingested_at: '2026-07-02T00:00:00.000Z',
            owner_user_id: 'user-1',
            partition_key: 'market.affiliate',
            chunk_count: 240,
          },
        ];
      }
      if (sql.includes('COUNT(DISTINCT s.id)::int AS total_sources')) {
        return [{ total_sources: 2, total_chunks: 460 }];
      }
      return [];
    });

    const result = await retrieveChunksWithAudit({
      query: 'find 20 affiliate opportunities',
      intentId: 'opportunity_discovery',
      userId: 'user-1',
      hybridSearch: false,
    });

    expect(result.corpusGate.status).toBe('sealed');
    expect(result.corpusGate.partition).toBe('market.affiliate');
    expect(result.corpusGate.reason).toContain('distinct_domains');
    expect(result.corpusGate.reason).toContain('single_domain_share');
  });
});
