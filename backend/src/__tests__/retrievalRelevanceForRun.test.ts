/**
 * The relevance check after retrieval, through `retrieveChunksWithAudit` with
 * only the database, the embedding call and the model replaced.
 *
 * The corpus is shared: a document one run stored is searched by every later
 * run. Before this check, a passage from an earlier run's unrelated document
 * was handed to the reasoner and the report whenever it matched the retrieval
 * query's words. Each test here fails on the code before the check existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  queryMock: vi.fn(),
  generateEmbeddingsMock: vi.fn(),
  hits: [] as Array<Record<string, unknown>>,
  events: [] as Array<{ phase: string; payload: Record<string, unknown> }>,
  /** What the stand-in judge says about an address. Anything not listed is relevant. */
  verdictByUrl: {} as Record<string, 'off_topic' | 'vendor_sales'>,
  judge: 'up' as 'up' | 'down',
  judged: [] as string[],
}));

vi.mock('../db/pool', () => ({ query: h.queryMock }));
vi.mock('../services/openrouter/openrouterService', async () => {
  const actual = await vi.importActual<typeof import('../services/openrouter/openrouterService')>('../services/openrouter/openrouterService');
  return {
    ...actual,
    generateEmbeddings: h.generateEmbeddingsMock,
    callRoleModel: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
      const text = options.messages.map((message) => message.content).join('\n');
      if (h.judge === 'down') throw Object.assign(new Error('POST https://openrouter.example/v1/chat?key=secret-judge-key failed'), { code: 'ETIMEDOUT' });
      const items = JSON.parse(text.slice(text.indexOf('[', text.indexOf('Items to judge')), text.lastIndexOf(']') + 1)) as Array<{ n: number; address: string }>;
      for (const item of items) h.judged.push(item.address);
      const verdicts = items.map((item) => ({ n: item.n, verdict: h.verdictByUrl[item.address] ?? 'relevant', why: h.verdictByUrl[item.address] ? 'about a different subject' : 'about the question' }));
      return { content: JSON.stringify({ verdicts }), model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
    }),
  };
});

import { retrieveChunksWithAudit } from '../services/retrieval/retrievalService';
import { documentKey, forgetRunVerdicts, rememberVerdict } from '../services/discovery/relevanceGate';
import {
  documentsSetAsideAtRetrieval,
  forgetRetrievalTally,
  relevanceCheckCausedShortfall,
  type RetrievalRelevanceReport,
  type RunRelevanceScope,
} from '../services/retrieval/runRelevanceFilter';

const RUN = '33333333-3333-4333-8333-333333333333';
const EARLIER_RUN = '44444444-4444-4444-8444-444444444444';
const QUESTION = 'What is being done to secure election data and voting practices for the 2026 presidential election?';

// Enough stored sources, across enough sites, for the corpus to be open to retrieval.
const DOMAINS = ['alpha.example.com', 'beta.example.org', 'gamma.example.net', 'delta.example.io', 'epsilon.example.dev', 'zeta.example.co', 'eta.example.ai', 'theta.example.app'];
const SOURCE_STATS = DOMAINS.flatMap((name, d) =>
  Array.from({ length: 4 }, (_, i) => ({
    source_id: `source-${d}-${i}`,
    source_url: `https://${name.split('.')[0]}${i}.${name.split('.').slice(1).join('.')}/article`,
    tags: ['partition:civic.elections'],
    published_at: '2026-07-01T00:00:00.000Z',
    ingested_at: '2026-07-02T00:00:00.000Z',
    owner_user_id: null,
    partition_key: 'civic.elections',
    chunk_count: 20,
  }))
);

const hit = (id: string, url: string, title: string, content: string, similarity: number, extra: Record<string, unknown> = {}) => ({
  id,
  content,
  chunk_index: 0,
  source_url: url,
  source_title: title,
  tags: ['partition:civic.elections'],
  similarity,
  evidence_tier: null,
  owner_user_id: null,
  imported_via: 'autonomous_discovery',
  discovered_by_run_id: EARLIER_RUN,
  ...extra,
});

const IOT_URL = 'https://arxiv.org/pdf/2210.02137';
// Stored by an earlier run about home networks. It matches "secure" and "data".
const IOT = hit('iot', IOT_URL, "Internet Service Providers' and Individuals' Attitudes, Barriers, and Incentives to Secure IoT", 'Users are unsure who should secure the data their home devices collect.', 0.84);
// Found for this run.
const EAC = hit('eac', 'https://www.eac.gov/election-security-2026', 'EAC update on election security for 2026', 'The Commission certifies voting systems ahead of the 2026 election.', 0.82, { discovered_by_run_id: RUN });
// Stored by an earlier run, and about this question all the same.
const CISA = hit('cisa', 'https://www.cisa.gov/topics/election-security', 'Election Security | CISA', 'CISA supports states in securing election infrastructure and voter data.', 0.8);

const reports: RetrievalRelevanceReport[] = [];
const scope: RunRelevanceScope = { runId: RUN, researchQuery: QUESTION, model: {}, onChecked: (report) => { reports.push(report); } };
const retrieve = (relevance: RunRelevanceScope | undefined = scope) =>
  retrieveChunksWithAudit({ query: 'election data security measures', intentId: 'timeline', userId: 'user-1', hybridSearch: false, runId: RUN, relevance });
const ids = async (relevance?: RunRelevanceScope) => (await retrieve(relevance)).citableChunks.map((chunk) => chunk.id);

const gateSetting = process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;

describe('the relevance check after retrieval', () => {
  beforeEach(() => {
    h.queryMock.mockReset();
    h.generateEmbeddingsMock.mockReset();
    h.generateEmbeddingsMock.mockResolvedValue([[0.1, 0.2, 0.3]]);
    h.hits = [IOT, EAC, CISA];
    h.events.length = 0;
    h.verdictByUrl = { [IOT_URL]: 'off_topic' };
    h.judge = 'up';
    h.judged.length = 0;
    reports.length = 0;
    forgetRunVerdicts();
    forgetRetrievalTally();
    delete process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;
    h.queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO discovery_events')) {
        h.events.push({ phase: String(params[2]), payload: JSON.parse(String(params[7])) });
        return [];
      }
      if (sql.includes('partition_key') && sql.includes('chunk_count')) return SOURCE_STATS;
      if (sql.includes('COUNT(DISTINCT s.id)::int AS total_sources')) return [{ total_sources: SOURCE_STATS.length + 10, total_chunks: 1400 }];
      if (sql.includes('FROM embeddings e')) return h.hits;
      return [];
    });
  });
  afterEach(() => {
    if (gateSetting === undefined) delete process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;
    else process.env.DISCOVERY_RELEVANCE_GATE_ENABLED = gateSetting;
  });

  it('leaves out a passage from an earlier run\'s unrelated document, and keeps an earlier run\'s relevant one', async () => {
    expect(await ids()).toEqual(['eac', 'cisa']);
    const event = h.events.find((entry) => entry.phase === 'relevance_retrieval');
    expect(event?.payload.not_used).toEqual([
      { url: IOT_URL, title: IOT.source_title, reason: 'off_topic', decided_by: 'model', why: 'about a different subject', passages: 1 },
    ]);
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ documentsJudged: 3, documentsExcluded: 1, decidedWithoutModel: 0 });
    expect(documentsSetAsideAtRetrieval(RUN)).toBe(1);
  });

  it('returns the same passages as before when no run scope is given', async () => {
    expect(await retrieveChunksWithAudit({ query: 'election data security measures', intentId: 'timeline', userId: 'user-1', hybridSearch: false, runId: RUN }).then((result) => result.citableChunks.map((chunk) => chunk.id))).toEqual(['iot', 'eac', 'cisa']);
    expect(h.judged).toHaveLength(0);
  });

  it('asks about each document once in a run, and records what it set aside once', async () => {
    await ids();
    h.judged.length = 0;
    expect(await ids()).toEqual(['eac', 'cisa']);
    expect(h.judged).toHaveLength(0);
    expect(h.events.filter((entry) => entry.phase === 'relevance_retrieval')).toHaveLength(1);
    expect(documentsSetAsideAtRetrieval(RUN)).toBe(1);
  });

  it('does not ask again about a document the discovery check already judged with a model', async () => {
    rememberVerdict(RUN, documentKey(IOT_URL), { relevant: false, reason: 'off_topic', note: 'home routers', basis: 'model' });
    rememberVerdict(RUN, documentKey(String(EAC.source_url)), { relevant: true, reason: null, note: '', basis: 'model' });
    expect(await ids()).toEqual(['eac', 'cisa']);
    expect(h.judged).toEqual([CISA.source_url]);
  });

  it('looks again at a document that discovery could only compare by wording', async () => {
    // Discovery's judge was down; shared wording let the paper through, marked as not confirmed.
    rememberVerdict(RUN, documentKey(IOT_URL), { relevant: true, reason: null, note: '', basis: 'word_overlap' });
    expect(await ids()).toEqual(['eac', 'cisa']);
    expect(h.judged).toContain(IOT_URL);
  });

  it('never leaves out a file or link the person attached to this run, and does not put it to the judge', async () => {
    const ATTACHED = hit('attached', 'https://example.org/my-notes', 'My notes', 'Notes on something else entirely.', 0.9, { discovered_by_run_id: RUN, imported_via: 'manual_url' });
    const OLD_UPLOAD = hit('old-upload', 'https://example.org/old-project-notes', 'Old project notes', 'Notes from an unrelated project.', 0.88, { imported_via: 'manual_url' });
    h.verdictByUrl[String(ATTACHED.source_url)] = 'off_topic';
    h.verdictByUrl[String(OLD_UPLOAD.source_url)] = 'off_topic';
    h.hits = [ATTACHED, OLD_UPLOAD, EAC];
    expect(await ids()).toEqual(['attached', 'eac']);
    expect(h.judged).not.toContain(ATTACHED.source_url);
    // The same person's notes from an earlier, unrelated request are judged like any other stored document.
    expect(h.judged).toContain(OLD_UPLOAD.source_url);
  });

  it('keeps an attachment whose content an earlier run had already stored, known only through its ingestion job', async () => {
    // The person attached this to the current run; the same content was stored before, so the source row still names the earlier run.
    const REATTACHED = hit('reattached', 'https://example.org/briefing', 'Briefing', 'A briefing on something else.', 0.9, { imported_via: 'manual_url' });
    h.verdictByUrl[String(REATTACHED.source_url)] = 'off_topic';
    h.hits = [REATTACHED, EAC];
    const answer = h.queryMock.getMockImplementation() as (sql: string, params?: unknown[]) => Promise<unknown>;
    h.queryMock.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("ij.metadata->>'research_run_id'")) return params[1] === RUN ? [{ id: 'reattached' }] : [];
      return answer(sql, params);
    });
    expect(await ids()).toEqual(['reattached', 'eac']);
    expect(h.judged).not.toContain(REATTACHED.source_url);
  });

  it('takes the top passages after the check, so an unrelated document does not use up a place', async () => {
    const more = Array.from({ length: 3 }, (_, i) => hit(`extra-${i}`, `https://www.eac.gov/extra-${i}`, `EAC note ${i}`, 'Election security note.', 0.5 - i * 0.01, { discovered_by_run_id: RUN }));
    h.hits = [IOT, EAC, CISA, ...more];
    const result = await retrieveChunksWithAudit({ query: 'election data security measures', intentId: 'timeline', userId: 'user-1', hybridSearch: false, runId: RUN, relevance: scope, topK: 3 });
    // Before, the unrelated document held one of the three places and only two passages came back.
    expect(result.citableChunks.map((chunk) => chunk.id)).toEqual(['eac', 'cisa', 'extra-0']);
  });

  it('when no model can judge, keeps the run going on shared wording, leaves the unrelated document out, and records it', async () => {
    h.judge = 'down';
    const UNRELATED = hit('bread', 'https://example.org/sourdough-starter', 'How to keep a sourdough starter alive', 'Flour, water and patience.', 0.9);
    h.hits = [UNRELATED, EAC, CISA];
    const kept = await ids();
    expect(kept).not.toContain('bread');
    expect(kept).toContain('eac');
    const event = h.events.find((entry) => entry.phase === 'relevance_retrieval');
    expect(event?.payload.decided_without_model).toBe(3);
    expect(event?.payload.failure_kinds).toEqual(['ETIMEDOUT']);
    expect(JSON.stringify(h.events)).not.toContain('secret-judge-key');
    expect(reports[0].decidedWithoutModel).toBe(3);
  });

  it('with the emergency switch off, leaves nothing out and asks no judge', async () => {
    process.env.DISCOVERY_RELEVANCE_GATE_ENABLED = 'false';
    expect(await ids()).toEqual(['iot', 'eac', 'cisa']);
    expect(h.judged).toHaveLength(0);
  });

  it('says the check caused a shortfall only when the set-aside documents would have covered it', () => {
    // 13 sources left, 3 set aside, 15 needed: the run had enough until the check.
    expect(relevanceCheckCausedShortfall({ usableSources: 13, setAside: 3, minimum: 15 })).toBe(true);
    // 7 left, 3 set aside, 15 needed: short either way; the existing checks decide.
    expect(relevanceCheckCausedShortfall({ usableSources: 7, setAside: 3, minimum: 15 })).toBe(false);
    expect(relevanceCheckCausedShortfall({ usableSources: 15, setAside: 3, minimum: 15 })).toBe(false);
    expect(relevanceCheckCausedShortfall({ usableSources: 5, setAside: 0, minimum: 15 })).toBe(false);
    expect(relevanceCheckCausedShortfall({ usableSources: 5, setAside: 4, minimum: undefined })).toBe(false);
  });
});
