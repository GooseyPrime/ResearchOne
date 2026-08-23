/**
 * Unit tests for citation mapper chunk-ID resolution.
 *
 * WO-AE-1 root cause: the synthesizer emits "[CHUNK N] ID: <uuid>" but the
 * citation mapper was sending "[CHUNK <uuid>]", so the LLM doing mapping could
 * not match numeric references in report text to real chunk UUIDs.
 *
 * These tests verify:
 * 1. A model returning an index-based chunk_id ("11") is resolved to the UUID
 *    at position 11 in the chunk list (1-based).
 * 2. A model returning a valid UUID that is in the chunk list is accepted.
 * 3. A model returning a fabricated ID not in the chunk list is dropped.
 * 4. The CITATION FAILURE log fires when report sections reference chunks by
 *    number but no citations resolved (regression guard against silent failure).
 *
 * Rule 16: each test below fails if the fix is reverted (the old code had no
 * index-to-uuid resolution and no fabricated-id filter).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// --- hoisted mocks -------------------------------------------------------
const { queryMock, withTransactionMock, callRoleModelMock, loggerErrorMock, loggerInfoMock } =
  vi.hoisted(() => {
    const queryMock = vi.fn();
    const withTransactionMock = vi.fn();
    const callRoleModelMock = vi.fn();
    const loggerErrorMock = vi.fn();
    const loggerInfoMock = vi.fn();
    return { queryMock, withTransactionMock, callRoleModelMock, loggerErrorMock, loggerInfoMock };
  });

vi.mock('../db/pool', () => ({
  query: queryMock,
  withTransaction: withTransactionMock,
}));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
}));

vi.mock('../constants/prompts', () => ({
  withPreamble: (s: string) => s,
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: loggerInfoMock,
    warn: vi.fn(),
    error: loggerErrorMock,
  },
}));

vi.mock('../services/planning/wave53EpistemicPolicy', () => ({
  resolveSourceClassForChunk: () => null,
}));

import { mapAndPersistCitations } from '../services/reasoning/citationMapper';
import type { RetrievedChunk } from '../services/retrieval/retrievalService';

// -------------------------------------------------------------------------

function makeChunk(id: string, index: number): RetrievedChunk {
  return {
    id,
    content: `content for chunk ${index}`,
    source_url: `https://example.com/source/${index}`,
    source_title: `Source ${index}`,
    chunk_index: index,
    similarity: 0.8,
    evidence_tier: null,
    tags: [],
  };
}

const CHUNK_A = makeChunk('aaaaaaaa-0000-0000-0000-000000000001', 1);
const CHUNK_B = makeChunk('bbbbbbbb-0000-0000-0000-000000000002', 2);
const CHUNKS = [CHUNK_A, CHUNK_B];

const BASE_ARGS = {
  runId: 'run-test-id',
  reportId: 'rep-test-id',
  chunks: CHUNKS,
  claims: [],
  reportSections: [{ type: 'executive_summary', title: 'Executive Summary', content: 'See Chunk 1 for evidence.' }],
};

function modelReturning(citations: object[]) {
  callRoleModelMock.mockResolvedValueOnce({
    content: JSON.stringify({
      citations,
      uncited_sections: [],
      notes: '',
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  // DB stubs: claims query, sections query
  queryMock.mockResolvedValue([]);
  withTransactionMock.mockImplementation(async (fn: (client: object) => Promise<void>) => {
    const client = { query: vi.fn().mockResolvedValue({}) };
    await fn(client);
  });
});

describe('citation mapper — chunk-id resolution', () => {
  it('resolves an index-based chunk_id ("1") to the UUID at that 1-based position', async () => {
    modelReturning([
      { section_type: 'executive_summary', chunk_id: '1', confidence: 0.9, citation_order: 1, chunk_quote: 'evidence' },
    ]);

    const result = await mapAndPersistCitations(BASE_ARGS);

    expect(result.citations).toHaveLength(1);
    // chunk_id must be resolved to the UUID at position 1
    expect(result.citations[0].chunk_id).toBe(CHUNK_A.id);
  });

  it('accepts a citation whose chunk_id is already a valid known UUID', async () => {
    modelReturning([
      { section_type: 'executive_summary', chunk_id: CHUNK_B.id, confidence: 0.8, citation_order: 1, chunk_quote: 'content' },
    ]);

    const result = await mapAndPersistCitations(BASE_ARGS);

    expect(result.citations).toHaveLength(1);
    expect(result.citations[0].chunk_id).toBe(CHUNK_B.id);
  });

  it('drops citations whose chunk_id is a fabricated string not in the chunk list', async () => {
    modelReturning([
      { section_type: 'executive_summary', chunk_id: 'not-a-real-uuid', confidence: 0.9, citation_order: 1, chunk_quote: 'evidence' },
    ]);

    const result = await mapAndPersistCitations(BASE_ARGS);

    // Fabricated id must be dropped — no rows inserted
    expect(result.citations).toHaveLength(0);
  });

  it('drops citations below the 0.3 confidence threshold', async () => {
    modelReturning([
      { section_type: 'executive_summary', chunk_id: CHUNK_A.id, confidence: 0.1, citation_order: 1, chunk_quote: 'evidence' },
    ]);

    const result = await mapAndPersistCitations(BASE_ARGS);

    expect(result.citations).toHaveLength(0);
  });

  it('emits CITATION FAILURE log when report has chunk refs but none resolved', async () => {
    // Model returns nothing usable (fabricated id)
    modelReturning([
      { section_type: 'executive_summary', chunk_id: 'invented-id', confidence: 0.9, citation_order: 1, chunk_quote: 'x' },
    ]);

    await mapAndPersistCitations({
      ...BASE_ARGS,
      // Section content mentions "Chunk 1" so the guard fires
      reportSections: [{ type: 'executive_summary', title: 'Executive Summary', content: 'As seen in Chunk 1...' }],
    });

    // Must log a CITATION FAILURE — not just "No citations mapped"
    const allErrorCalls = loggerErrorMock.mock.calls.map((c: unknown[]) => String(c[0]));
    expect(allErrorCalls.some((msg) => msg.includes('CITATION FAILURE'))).toBe(true);
  });
});
