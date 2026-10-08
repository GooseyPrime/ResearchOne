/**
 * The Evidence tab of a report written with the citation lock listed bare cited
 * passages, not findings: no stored finding was tied to any of the report's
 * citations.
 *
 * Nothing tied them. The step that used to set a citation's finding is skipped
 * for a locked report; findings were extracted from the first thirty passages
 * retrieved, whether or not the report cited them; and each finding was filed
 * under the first passage id the model listed, the only one the page compared.
 *
 * These tests run the real extraction and the real page assembly, with the model
 * and the database replaced, on the rows a locked report has when findings are
 * extracted.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  callRoleModel: vi.fn(),
  query: vi.fn(),
  inserts: [] as unknown[][],
}));

vi.mock('../services/openrouter/openrouterService', async () => {
  const actual = await vi.importActual<typeof import('../services/openrouter/openrouterService')>('../services/openrouter/openrouterService');
  return { ...actual, callRoleModel: mocks.callRoleModel };
});

vi.mock('../db/pool', () => ({
  query: mocks.query,
  queryOne: vi.fn(),
  withTransaction: async (run: (client: { query: (sql: string, params: unknown[]) => Promise<void> }) => Promise<void>) =>
    run({
      query: async (_sql: string, params: unknown[]) => {
        mocks.inserts.push(params);
      },
    }),
}));

vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { extractAndPersistClaims, passagesForExtraction, resolveFindingPassages } from '../services/reasoning/claimExtractor';
import { buildReaderEvidence, loadReaderEvidence, type ReaderClaimRow } from '../services/formatting/readerEvidence';
import type { RetrievedChunk } from '../services/retrieval/retrievalService';

const uuid = (n: number): string => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

/** Thirty-five passages, as a run retrieves them. The report cites the 33rd and 34th: past the thirty the extraction is shown. */
const CHUNKS: RetrievedChunk[] = Array.from({ length: 35 }, (_, index) => ({
  id: uuid(index + 1),
  content: `Passage ${index + 1} of the retrieved material.`,
  source_url: `https://example.org/source-${index + 1}`,
  source_title: `Source ${index + 1}`,
  chunk_index: 0,
  similarity: 0.9,
  evidence_tier: null,
  tags: [],
}));
const CITED_A = uuid(33);
const CITED_B = uuid(34);
const UNCITED = uuid(2);
const INVENTED = '99999999-9999-4999-8999-999999999999';

/** The citations a locked report is saved with, before findings are extracted. */
const SAVED_CITATIONS = [
  { chunk_id: CITED_A, source_id: 'source-a', chunk_quote: 'The trial met its primary endpoint.' },
  { chunk_id: CITED_B, source_id: 'source-b', chunk_quote: 'Approval followed in December 2023.' },
  { chunk_id: CITED_A, source_id: 'source-a', chunk_quote: 'No serious adverse events were recorded.' },
];

const MODEL_FINDINGS = [
  // Lists a passage the report does not cite first, then one it does.
  { claim_text: 'The trial met its primary endpoint.', evidence_tier: 'strong_evidence', confidence: 0.9, supporting_chunk_ids: [UNCITED, CITED_A], source_ids: ['not-a-source-id'], tags: [], is_conclusion_critical: true },
  // Writes an id that is not a passage of this run, and the right one in capitals.
  { claim_text: 'Approval followed in December 2023.', evidence_tier: 'established_fact', confidence: 0.8, supporting_chunk_ids: [INVENTED, CITED_B.toUpperCase()], source_ids: [], tags: [], is_conclusion_critical: false },
  // Rests on nothing the run holds.
  { claim_text: 'A statement with no passage behind it.', evidence_tier: 'inference', confidence: 0.4, supporting_chunk_ids: [INVENTED], source_ids: [], tags: [], is_conclusion_critical: false },
];

const modelReply = { content: JSON.stringify(MODEL_FINDINGS), model: 'm', role: 'verifier', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'm' };

async function extract() {
  return extractAndPersistClaims({
    runId: 'run-1',
    reportId: 'report-1',
    researchQuery: 'When was the therapy approved?',
    chunks: CHUNKS,
    reasonerOutput: 'reasoning',
    synthesizerOutput: 'The trial met its primary endpoint [1]. Approval followed in December 2023 [2].',
  });
}

/** The stored finding rows as the page reads them back: columns 1, 2, 3, 4 and 10 of the insert. */
function storedFindings(): ReaderClaimRow[] {
  return mocks.inserts.map((params, index) => ({
    id: `finding-${index + 1}`,
    chunk_id: params[0] as string | null,
    source_id: params[1] as string | null,
    claim_text: params[2] as string,
    evidence_tier: params[3] as string,
    supporting_chunk_ids: params[9] as string[],
  }));
}

const citationRow = (over: Record<string, unknown>) => ({
  section_id: 's1',
  chunk_id: CITED_A,
  claim_id: null,
  source_id: 'source-a',
  citation_text: '[1]',
  citation_order: 0,
  chunk_quote: 'The trial met its primary endpoint.',
  source_title: 'A trial report',
  source_url: 'https://example.org/source-33',
  source_authors: null,
  source_publication: 'A journal',
  source_published_at: null,
  source_filename: null,
  source_kind: 'journal article',
  source_provider: 'pmc',
  ...over,
});
const REPORT_CITATIONS = [
  citationRow({}),
  citationRow({ citation_order: 1, citation_text: '[2]', chunk_id: CITED_B, source_id: 'source-b', chunk_quote: 'Approval followed in December 2023.', source_title: 'An approval notice' }),
  citationRow({ citation_order: 2, chunk_quote: 'No serious adverse events were recorded.' }),
];

describe('findings of a report written with the citation lock', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.callRoleModel.mockResolvedValue(modelReply);
    mocks.query.mockImplementation(async (sql: string) => (sql.includes('FROM report_citations') ? SAVED_CITATIONS : []));
  });

  it('shows the extraction the passages the report cites, first, with what the report quoted from them', async () => {
    await extract();
    expect(mocks.query).toHaveBeenCalledWith(expect.stringContaining('FROM report_citations WHERE report_id = $1'), ['report-1']);
    const prompt: string = mocks.callRoleModel.mock.calls[0][0].messages[1].content;
    const first = prompt.indexOf(`[CHUNK ${CITED_A}]`);
    const second = prompt.indexOf(`[CHUNK ${CITED_B}]`);
    expect(first).toBeGreaterThan(-1);
    expect(second).toBeGreaterThan(first);
    // Ahead of the passage retrieved first, which the report does not cite.
    expect(second).toBeLessThan(prompt.indexOf(`[CHUNK ${uuid(1)}]`));
    expect(prompt).toContain('Cited in the report, which quotes: "The trial met its primary endpoint." "No serious adverse events were recorded."');
    expect(prompt).toContain('The report cites the chunks marked "Cited in the report".');
    // Still thirty passages, no more.
    expect(prompt.match(/\[CHUNK /g)).toHaveLength(30);
  });

  it('shows the extraction every cited passage when the report cites more than thirty', async () => {
    const many = CHUNKS.slice(0, 33).map((chunk) => ({ chunk_id: chunk.id, source_id: 'source-a', chunk_quote: `Quoted from ${chunk.source_title}.` }));
    mocks.query.mockImplementation(async (sql: string) => (sql.includes('FROM report_citations') ? many : []));
    await extract();
    const prompt: string = mocks.callRoleModel.mock.calls[0][0].messages[1].content;
    expect(prompt.match(/\nCited in the report, which quotes: /g)).toHaveLength(33);
    expect(prompt).toContain(`[CHUNK ${uuid(33)}]`);
    expect(prompt).toContain('"Quoted from Source 33."');
    // No room is taken by passages the report does not cite.
    expect(prompt.match(/\[CHUNK /g)).toHaveLength(33);
  });

  it('files each finding under a passage the report cites, and keeps only passages the run holds', async () => {
    await extract();
    expect(mocks.inserts).toHaveLength(3);
    const [endpoint, approval, unsupported] = storedFindings();
    expect(endpoint.chunk_id).toBe(CITED_A);
    expect(endpoint.source_id).toBe('source-a');
    expect(endpoint.supporting_chunk_ids).toEqual([UNCITED, CITED_A]);
    // The id written in capitals is the passage it names; the invented one is gone.
    expect(approval.chunk_id).toBe(CITED_B);
    expect(approval.source_id).toBe('source-b');
    expect(approval.supporting_chunk_ids).toEqual([CITED_B]);
    // Nothing invented reaches the database, where it would refuse the whole batch.
    expect(unsupported.chunk_id).toBeNull();
    expect(unsupported.source_id).toBeNull();
    expect(unsupported.supporting_chunk_ids).toEqual([]);
    expect(JSON.stringify(mocks.inserts)).not.toContain(INVENTED);
    expect(JSON.stringify(mocks.inserts)).not.toContain('not-a-source-id');
  });

  it('gives the Evidence tab findings, each with the passages the report quoted, not a list of bare passages', async () => {
    await extract();
    const page = buildReaderEvidence({ status: { word: 'Ready', reason: null }, citationRows: REPORT_CITATIONS as never, claimRows: storedFindings() });
    expect(page.findings.map((finding) => finding.text)).toEqual(['The trial met its primary endpoint.', 'Approval followed in December 2023.']);
    expect(page.findings[0].quotes).toEqual(['The trial met its primary endpoint.', 'No serious adverse events were recorded.']);
    expect(page.findings[0].sourceIds).toEqual(['source-a']);
    expect(page.findings[1].quotes).toEqual(['Approval followed in December 2023.']);
    expect(page.findings[1].sourceIds).toEqual(['source-b']);
  });

  it('lists a finding filed under a passage the report does not cite when another of its passages is cited', () => {
    const filedElsewhere: ReaderClaimRow = { id: 'f1', claim_text: 'The trial met its primary endpoint.', evidence_tier: 'strong_evidence', source_id: null, chunk_id: UNCITED, supporting_chunk_ids: [UNCITED, CITED_A] };
    const unrelated: ReaderClaimRow = { id: 'f2', claim_text: 'Something the report never cites.', evidence_tier: 'inference', source_id: null, chunk_id: UNCITED, supporting_chunk_ids: [UNCITED, uuid(3)] };
    const page = buildReaderEvidence({ status: { word: 'Ready', reason: null }, citationRows: REPORT_CITATIONS as never, claimRows: [filedElsewhere, unrelated] });
    expect(page.findings.map((finding) => finding.text)).toEqual(['The trial met its primary endpoint.']);
    // A row read from a database without the column, or holding none, is judged by the passage it is filed under.
    const older = buildReaderEvidence({ status: { word: 'Ready', reason: null }, citationRows: REPORT_CITATIONS as never, claimRows: [{ ...filedElsewhere, supporting_chunk_ids: null }] });
    expect(older.findings).toEqual([]);
  });

  it('reads every passage a finding rests on when the page loads', async () => {
    const reads: string[] = [];
    const read = async <T>(sql: string): Promise<T[]> => {
      reads.push(sql);
      if (sql.includes('FROM report_citations')) return REPORT_CITATIONS as never;
      if (sql.includes('FROM claims')) return [{ id: 'f1', claim_text: 'The trial met its primary endpoint.', evidence_tier: 'strong_evidence', source_id: null, chunk_id: UNCITED, supporting_chunk_ids: [UNCITED, CITED_A] }] as never;
      return [{ status: 'completed', gate_status: 'completed', retrieval_ids: [] }] as never;
    };
    const page = await loadReaderEvidence({ id: 'report-1', status: 'finalized', run_id: 'run-1' }, read);
    expect(reads.find((sql) => sql.includes('FROM claims'))).toContain('supporting_chunk_ids');
    expect(page.findings).toHaveLength(1);
  });
});

describe('a report with no saved citations when findings are extracted', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.inserts.length = 0;
    mocks.callRoleModel.mockResolvedValue(modelReply);
    mocks.query.mockResolvedValue([]);
  });

  it('is extracted and filed exactly as before', async () => {
    await extract();
    const prompt: string = mocks.callRoleModel.mock.calls[0][0].messages[1].content;
    const shown = CHUNKS.slice(0, 30)
      .map((chunk) => `[CHUNK ${chunk.id}] Source: ${chunk.source_url}\n${chunk.content}`)
      .join('\n---\n');
    expect(prompt).toBe(
      `Research Query: When was the therapy approved?\n\nEvidence Chunks:\n${shown}\n\nReasoner Output:\nreasoning\n\nSynthesizer Output:\nThe trial met its primary endpoint [1]. Approval followed in December 2023 [2].\n\nExtract all discrete claims. Output JSON array only.`
    );
    const [endpoint, approval] = storedFindings();
    expect(endpoint.chunk_id).toBe(UNCITED);
    expect(endpoint.source_id).toBe('not-a-source-id');
    expect(endpoint.supporting_chunk_ids).toEqual([UNCITED, CITED_A]);
    expect(approval.chunk_id).toBe(INVENTED);
  });

  it('is extracted as before when the saved citations cannot be read', async () => {
    mocks.query.mockRejectedValue(new Error('connection lost'));
    await extract();
    const prompt: string = mocks.callRoleModel.mock.calls[0][0].messages[1].content;
    expect(prompt).not.toContain('Cited in the report');
    expect(storedFindings()[0].chunk_id).toBe(UNCITED);
  });
});

describe('the two rules on their own', () => {
  it('shows cited passages first, and with none cited the first thirty as before', () => {
    const list = [{ id: 'a' }, { id: 'B' }, { id: 'c' }];
    expect(passagesForExtraction(list, new Set(['b', 'c'])).map((entry) => entry.id)).toEqual(['B', 'c', 'a']);
    expect(passagesForExtraction(list, new Set())).toEqual(list);
    const forty = Array.from({ length: 40 }, (_, n) => ({ id: `p${n}` }));
    expect(passagesForExtraction(forty, new Set()).map((entry) => entry.id)).toEqual(forty.slice(0, 30).map((entry) => entry.id));
  });

  it('shows every passage the report cites, however many, and limits only the uncited ones', () => {
    const fifty = Array.from({ length: 50 }, (_, n) => ({ id: `p${n}` }));
    // Thirty-six cited, scattered through the run's passages: more than the thirty shown before.
    const cited = new Set(fifty.filter((_, n) => n % 4 !== 0).slice(0, 36).map((entry) => entry.id));
    const shown = passagesForExtraction(fifty, cited).map((entry) => entry.id);
    expect(shown).toHaveLength(36);
    expect(new Set(shown)).toEqual(cited);
    // Ten cited: all ten, then uncited ones up to thirty in all.
    const ten = new Set(fifty.slice(40).map((entry) => entry.id));
    const mixed = passagesForExtraction(fifty, ten).map((entry) => entry.id);
    expect(mixed).toHaveLength(30);
    expect(mixed.slice(0, 10)).toEqual(fifty.slice(40).map((entry) => entry.id));
    expect(mixed.slice(10)).toEqual(fifty.slice(0, 20).map((entry) => entry.id));
  });

  it('prefers a cited passage, falls back to one the run holds, and drops what it does not hold', () => {
    const known = new Map([['a', 'a'], ['b', 'b']]);
    const cited = new Map([['b', { sourceId: 's-b' }]]);
    expect(resolveFindingPassages(['a', 'b', 'zz', 'a'], known, cited)).toEqual({ chunkId: 'b', sourceId: 's-b', supporting: ['a', 'b'] });
    expect(resolveFindingPassages(['a'], known, cited)).toEqual({ chunkId: 'a', sourceId: null, supporting: ['a'] });
    expect(resolveFindingPassages(undefined, known, cited)).toEqual({ chunkId: null, sourceId: null, supporting: [] });
    expect(resolveFindingPassages([7, null, 'zz'], known, cited)).toEqual({ chunkId: null, sourceId: null, supporting: [] });
  });
});
