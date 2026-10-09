/**
 * Reference details through a whole discovery pass, with only the outside
 * world replaced (search providers, the database, the queue, the planner).
 *
 * Two faults a review found in slice 4, part 2:
 *  - an address found by two providers kept the details of whichever provider
 *    answered first, so a web result arriving before the publisher's record
 *    left the source with no authors;
 *  - a source already stored from an earlier run was skipped without being
 *    given the details this run's provider had, so it kept a bare reference
 *    entry for good.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SearchResultCandidate } from '../services/discovery/providerTypes';

const STORED_URL = 'https://doi.org/10.1/stored';
const NEW_URL = 'https://doi.org/10.1/new';
const STORED_ID = '99999999-9999-4999-8999-999999999999';

const h = vi.hoisted(() => ({
  queries: [] as Array<{ sql: string; params: unknown[] }>,
  queued: [] as Array<Record<string, unknown>>,
  delays: { tavily: 0, crossref: 0, openalex: 0 } as Record<string, number>,
  failFill: false,
}));

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    h.queries.push({ sql, params });
    if (h.failFill && /UPDATE sources\s+SET authors/.test(sql)) throw new Error('connection lost');
    return [];
  }),
  queryOne: vi.fn(async (sql: string, params: unknown[] = []) => {
    h.queries.push({ sql, params });
    if (/SELECT id FROM sources WHERE url=/.test(sql) && params.includes(STORED_URL)) return { id: STORED_ID };
    return null;
  }),
  withTransaction: vi.fn(),
  adminQuery: vi.fn(async () => []),
}));

vi.mock('../queue/queues', () => ({
  ingestionQueue: { add: vi.fn(async (_name: string, data: Record<string, unknown>) => { h.queued.push(data); }) },
  embeddingQueue: { add: vi.fn() },
}));

vi.mock('axios', () => {
  const head = vi.fn(async () => ({ status: 200 }));
  return { default: { head, get: vi.fn(), post: vi.fn(), create: () => ({ head, get: vi.fn(), post: vi.fn() }) } };
});

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
    // The relevance check asks a model about every candidate before it is queued.
    // These fixtures are about the question asked, and the stand-in judge says so.
    const toJudge = /Items to judge \((\d+)\)/.exec(options.messages.map((message) => message.content).join('\n'));
    if (toJudge) {
      const verdicts = Array.from({ length: Number(toJudge[1]) }, (_, at) => ({ n: at + 1, verdict: 'relevant', why: 'about the question' }));
      return { content: JSON.stringify({ verdicts }), model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
    }
    const followUp = options.messages.some((message) => message.content.includes('Round 1 candidates'));
    const content = followUp
      ? '{"rationale":"covered","follow_up_queries":[],"exclusion_patterns":[]}'
      : '{"need_external_discovery":true,"rationale":"r","discovery_queries":["nuclear construction cost history"],"target_source_types":[],"preferred_evidence_tiers":[],"max_sources_to_ingest":5,"exclusion_patterns":[],"disconfirming_evidence_criteria":""}';
    return { content, model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
  }),
  getSystemPrompt: () => '',
}));

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const candidate = (provider: string, url: string, extra: Partial<SearchResultCandidate> = {}): SearchResultCandidate => ({
  url,
  title: 'Historical construction costs of nuclear power reactors',
  snippet: 'Nuclear construction cost history by country.',
  score: 0.9,
  rank: 1,
  provider,
  sourceQuery: 'nuclear construction cost history',
  ...extra,
});

const CROSSREF_DETAILS = { authors: ['Lovering, Jessica R.', 'Yip, Arthur'], publisher: 'Energy Policy', publishedAt: '2016-04-01' };
const OPENALEX_DETAILS = { authors: ['Jessica R. Lovering'], kind: 'journal article' };

vi.mock('../services/discovery/providers/tavilySearch', () => ({
  TavilySearchProvider: class {
    readonly name = 'tavily';
    async search() {
      await wait(h.delays.tavily);
      return [candidate('tavily', NEW_URL)];
    }
  },
}));
vi.mock('../services/discovery/providers/crossrefSearch', () => ({
  CrossrefSearchProvider: class {
    readonly name = 'crossref';
    async search() {
      await wait(h.delays.crossref);
      return [candidate('crossref', NEW_URL, { score: 0.5, rank: 3, bibliographic: CROSSREF_DETAILS })];
    }
  },
}));
vi.mock('../services/discovery/providers/openAlexSearch', () => ({
  OpenAlexSearchProvider: class {
    readonly name = 'openalex';
    async search() {
      await wait(h.delays.openalex);
      return [
        candidate('openalex', NEW_URL, { score: 0.4, rank: 5, bibliographic: OPENALEX_DETAILS }),
        candidate('openalex', STORED_URL, { score: 0.8, rank: 2, bibliographic: OPENALEX_DETAILS }),
      ];
    }
  },
}));

import { runDiscoveryOrchestrator } from '../services/discovery/discoveryOrchestrator';
import { config, runWithFlags } from '../config';

type Settings = { enabled: boolean; provider: string; ingestionWaitTimeoutMs: number };
const discoveryWas: Settings = { enabled: config.discovery.enabled, provider: config.discovery.provider, ingestionWaitTimeoutMs: config.discovery.ingestionWaitTimeoutMs };
const LOCK_ON = { CITATION_LOCK_ENABLED: true, BASELINE_LAYER_ENABLED: true };

function discover() {
  return runDiscoveryOrchestrator({
    runId: '11111111-1111-4111-8111-111111111111',
    researchQuery: 'Why do nuclear plants cost more to build in the United States?',
    plan: {},
    specialistAgentIds: ['story_verifier'],
    maxCoverageRounds: 2,
  });
}

const queuedMetadata = () => h.queued.map((job) => job.metadata as Record<string, unknown>);
const fills = () => h.queries.filter((entry) => /UPDATE sources\s+SET authors/.test(entry.sql));

describe('reference details through discovery', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.queued.length = 0;
    h.delays = { tavily: 0, crossref: 0, openalex: 0 };
    h.failFill = false;
    // The test environment turns discovery off; these tests are about discovery.
    (config.discovery as Settings).enabled = true;
    (config.discovery as Settings).provider = 'tavily';
    // Nothing ingests here, so there is nothing to wait for.
    (config.discovery as Settings).ingestionWaitTimeoutMs = 0;
  });
  afterEach(() => {
    Object.assign(config.discovery, discoveryWas);
  });

  it('queues one job for an address three providers found, with the fullest record', async () => {
    h.delays = { tavily: 0, crossref: 20, openalex: 40 };
    const summary = await runWithFlags(LOCK_ON, discover);
    expect(h.queued).toHaveLength(1);
    expect(h.queued[0].url).toBe(NEW_URL);
    expect(queuedMetadata()[0].bibliographic).toEqual({ ...CROSSREF_DETAILS, kind: 'journal article', provider: 'crossref' });
    // Still the candidate the first provider returned: its score and rank decide the order.
    expect(summary.sources.find((source) => source.url === NEW_URL)?.provider).toBe('tavily');
  });

  it('queues the same record whichever provider answers first', async () => {
    h.delays = { tavily: 40, crossref: 20, openalex: 0 };
    await runWithFlags(LOCK_ON, discover);
    expect(h.queued).toHaveLength(1);
    expect(queuedMetadata()[0].bibliographic).toEqual({ ...CROSSREF_DETAILS, kind: 'journal article', provider: 'crossref' });
  });

  it('gives a source stored by an earlier run the details this run found, and still skips it', async () => {
    const summary = await runWithFlags(LOCK_ON, discover);
    expect(h.queued.some((job) => job.url === STORED_URL)).toBe(false);
    expect(summary.sources.find((source) => source.url === STORED_URL)?.skipReason).toBe('already_in_corpus');
    expect(fills()).toHaveLength(1);
    const [id, authors, publisher, publishedAt, record] = fills()[0].params;
    expect(id).toBe(STORED_ID);
    expect(authors).toEqual(['Jessica R. Lovering']);
    expect(publisher).toBeNull();
    expect(publishedAt).toBeNull();
    expect(JSON.parse(String(record))).toEqual({ provider: 'openalex', kind: 'journal article', authors: ['Jessica R. Lovering'] });
    // Fills gaps only: nothing a stored source already records is replaced.
    expect(fills()[0].sql).toContain('authors = COALESCE(authors,');
    // The record kept under metadata is merged key by key, stored keys first.
    expect(fills()[0].sql).toContain("$5::jsonb || (metadata->'bibliographic')");
  });

  it('finishes the run when the stored source cannot be updated', async () => {
    h.failFill = true;
    const summary = await runWithFlags(LOCK_ON, discover);
    expect(summary.sources.find((source) => source.url === STORED_URL)?.skipReason).toBe('already_in_corpus');
    expect(h.queued).toHaveLength(1);
  });

  it('stores and queues nothing new with the citation lock off', async () => {
    h.delays = { tavily: 0, crossref: 20, openalex: 40 };
    await discover();
    expect(h.queued).toHaveLength(1);
    expect(queuedMetadata()[0]).toEqual({ discovery_run_id: '11111111-1111-4111-8111-111111111111' });
    expect(fills()).toHaveLength(0);
  });
});
