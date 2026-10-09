/**
 * The citation mapper never hands the database an id a model made up.
 *
 * The mapper model is shown passages with their ids, claims as "[CLAIM N]
 * text" and no source ids at all, and is asked for a `source_id` and a
 * `claim_id` with each citation. Whatever it wrote there went into a UUID
 * column as it stood. One value that was not a stored id failed its insert,
 * and since the inserts share a transaction, every citation of the report was
 * lost with it: the report was saved, every source showed as not cited, and
 * the reading page said "No mapped citations available".
 *
 * The stand-in database below behaves as Postgres does: a value that is not a
 * UUID is refused, and after a refused statement the transaction refuses
 * everything until it is rolled back to a savepoint. Each test fails on the
 * code before the fix.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  callRoleModelMock: vi.fn(),
  saved: [] as unknown[][],
  /** Passage ids the stand-in database refuses with a foreign-key error. */
  missingChunks: new Set<string>(),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

vi.mock('../db/pool', () => ({
  query: h.queryMock,
  withTransaction: async (work: (client: { query: (sql: string, params?: unknown[]) => Promise<unknown> }) => Promise<void>) => {
    let aborted = false;
    const committed: unknown[][] = [];
    const client = {
      query: async (sql: string, params: unknown[] = []) => {
        if (/^ROLLBACK TO SAVEPOINT/.test(sql)) {
          aborted = false;
          return {};
        }
        if (aborted) throw Object.assign(new Error('current transaction is aborted, commands ignored until end of transaction block'), { code: '25P02' });
        if (/INSERT INTO report_citations/.test(sql)) {
          // $3 passage, $4 source, $5 claim: UUID columns.
          for (const value of [params[2], params[3], params[4]]) {
            if (value !== null && !(typeof value === 'string' && UUID.test(value))) {
              aborted = true;
              throw Object.assign(new Error(`invalid input syntax for type uuid: "${String(value)}"`), { code: '22P02' });
            }
          }
          if (h.missingChunks.has(String(params[2]))) {
            aborted = true;
            throw Object.assign(new Error('insert or update on table "report_citations" violates foreign key constraint'), { code: '23503' });
          }
          committed.push(params);
        }
        return {};
      },
    };
    await work(client);
    // Reached only when the work did not throw: the rows are committed.
    h.saved.push(...committed);
  },
}));
vi.mock('../services/openrouter/openrouterService', () => ({ callRoleModel: h.callRoleModelMock }));
vi.mock('../constants/prompts', () => ({ withPreamble: (text: string) => text }));
vi.mock('../services/planning/wave53EpistemicPolicy', () => ({ resolveSourceClassForChunk: () => null }));

import { mapAndPersistCitations, resolveClaimId } from '../services/reasoning/citationMapper';
import type { RetrievedChunk } from '../services/retrieval/retrievalService';
import type { ExtractedClaim } from '../services/reasoning/claimExtractor';

const chunk = (id: string, n: number): RetrievedChunk => ({
  id,
  content: `passage ${n}`,
  source_url: `https://www.eac.gov/page-${n}`,
  source_title: `EAC page ${n}`,
  chunk_index: 0,
  similarity: 0.8,
  evidence_tier: null,
  tags: [],
});
const CHUNK_1 = chunk('aaaaaaaa-0000-4000-8000-000000000001', 1);
const CHUNK_2 = chunk('bbbbbbbb-0000-4000-8000-000000000002', 2);
const CHUNK_3 = chunk('cccccccc-0000-4000-8000-000000000003', 3);
const SOURCE_OF: Record<string, string> = {
  [CHUNK_1.id]: '11111111-0000-4000-8000-00000000000a',
  [CHUNK_2.id]: '22222222-0000-4000-8000-00000000000b',
  [CHUNK_3.id]: '22222222-0000-4000-8000-00000000000b',
};
const claim = (text: string): ExtractedClaim => ({ claim_text: text, evidence_tier: 'strong_evidence', confidence: 0.8, supporting_chunk_ids: [], source_ids: [], tags: [], is_conclusion_critical: false });
const CLAIMS = [claim('The EAC certifies voting systems.'), claim('States audit their results.')];
const CLAIM_IDS = ['c1c1c1c1-0000-4000-8000-000000000001', 'c2c2c2c2-0000-4000-8000-000000000002'];

const ARGS = {
  runId: 'run-1',
  reportId: 'dddddddd-0000-4000-8000-000000000004',
  chunks: [CHUNK_1, CHUNK_2, CHUNK_3],
  claims: CLAIMS,
  reportSections: [{ type: 'executive_summary', title: 'Summary', content: 'Certification is described in [Chunk 1] and audits in [Chunk 2].' }],
};

function modelReturns(citations: object[]) {
  h.callRoleModelMock.mockResolvedValueOnce({ content: JSON.stringify({ citations, uncited_sections: [], notes: '' }) });
}

describe('saving mapped citations', () => {
  beforeEach(() => {
    h.queryMock.mockReset();
    h.callRoleModelMock.mockReset();
    h.saved.length = 0;
    h.missingChunks.clear();
    h.queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('FROM claims WHERE run_id')) return CLAIMS.map((entry, at) => ({ id: CLAIM_IDS[at], claim_text: entry.claim_text }));
      if (sql.includes('FROM report_sections')) return [{ id: 'eeeeeeee-0000-4000-8000-000000000005', section_type: 'executive_summary' }];
      if (sql.includes('FROM chunks WHERE id = ANY')) return (params[0] as string[]).map((id) => ({ id, source_id: SOURCE_OF[id] ?? null }));
      return [];
    });
  });

  it('saves every citation when the model writes a claim label and a link where ids were asked for', async () => {
    modelReturns([
      { section_type: 'executive_summary', chunk_id: '1', source_id: 'https://www.eac.gov/page-1', claim_id: 'CLAIM 1', chunk_quote: 'certifies', citation_order: 1, confidence: 0.9 },
      { section_type: 'executive_summary', chunk_id: CHUNK_2.id, source_id: 'null', claim_id: 2, chunk_quote: 'audit', citation_order: 2, confidence: 0.8 },
      { section_type: 'executive_summary', chunk_id: CHUNK_3.id, source_id: '99999999-0000-4000-8000-000000000099', claim_id: '99999999-0000-4000-8000-000000000098', chunk_quote: 'x', citation_order: 3, confidence: 0.7 },
    ]);

    await mapAndPersistCitations(ARGS);

    // All three are saved. Before the fix the first refused value lost all of them.
    expect(h.saved).toHaveLength(3);
    // The source comes from storage, never from the model's guess.
    expect(h.saved.map((params) => params[3])).toEqual([SOURCE_OF[CHUNK_1.id], SOURCE_OF[CHUNK_2.id], SOURCE_OF[CHUNK_3.id]]);
    // A claim label or number is the stored claim it names; an id of no stored claim is dropped.
    expect(h.saved.map((params) => params[4])).toEqual([CLAIM_IDS[0], CLAIM_IDS[1], null]);
  });

  it('leaves out one citation the database refuses and keeps the rest', async () => {
    h.missingChunks.add(CHUNK_2.id);
    modelReturns([
      { section_type: 'executive_summary', chunk_id: CHUNK_1.id, chunk_quote: 'a', citation_order: 1, confidence: 0.9 },
      { section_type: 'executive_summary', chunk_id: CHUNK_2.id, chunk_quote: 'b', citation_order: 2, confidence: 0.9 },
      { section_type: 'executive_summary', chunk_id: CHUNK_3.id, chunk_quote: 'c', citation_order: 3, confidence: 0.9 },
    ]);

    await mapAndPersistCitations(ARGS);

    expect(h.saved.map((params) => params[2])).toEqual([CHUNK_1.id, CHUNK_3.id]);
  });

  it('still saves by passage when the sources of the passages cannot be read', async () => {
    h.queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM chunks WHERE id = ANY')) throw Object.assign(new Error('connection lost'), { code: '08006' });
      return [];
    });
    modelReturns([{ section_type: 'executive_summary', chunk_id: CHUNK_1.id, chunk_quote: 'a', citation_order: 1, confidence: 0.9 }]);
    await mapAndPersistCitations(ARGS);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0][3]).toBeNull();
  });

  it('reads what a model writes for a claim as the stored claim it names, or nothing', () => {
    const byText = new Map(CLAIMS.map((entry, at) => [entry.claim_text, CLAIM_IDS[at]]));
    const known = new Set(CLAIM_IDS);
    const read = (raw: unknown) => resolveClaimId(raw, CLAIMS, byText, known);
    expect(read('CLAIM 2')).toBe(CLAIM_IDS[1]);
    expect(read('[CLAIM 1]')).toBe(CLAIM_IDS[0]);
    expect(read(2)).toBe(CLAIM_IDS[1]);
    expect(read('States audit their results.')).toBe(CLAIM_IDS[1]);
    expect(read(CLAIM_IDS[0])).toBe(CLAIM_IDS[0]);
    for (const nothing of [null, undefined, '', 'null', 'CLAIM 9', '99999999-0000-4000-8000-000000000098', 'see the summary', 0]) expect(read(nothing)).toBeNull();
  });
});
