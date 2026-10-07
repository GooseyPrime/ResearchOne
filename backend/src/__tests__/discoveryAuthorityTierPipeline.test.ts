/**
 * Slice 6. The authority tier through a whole discovery pass, with only the
 * outside world replaced. Two faults a review found in part 1:
 *  - the tier was decided in the ingestion worker, which a run's switches do
 *    not reach, so a run with the switch on for that run alone stored no tier;
 *  - the tier was read from reference details that discovery drops when the
 *    citation lock is off, so a journal article reached by its DOI link was
 *    stored as an unknown published work.
 * Discovery now decides the tier itself, inside the run, from each provider's
 * own record, and sends it with the job.
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
}));

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    h.queries.push({ sql, params });
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
const TIERS_ON = { AUTHORITY_TIERS_ENABLED: true };
const BOTH_ON = { AUTHORITY_TIERS_ENABLED: true, CITATION_LOCK_ENABLED: true, BASELINE_LAYER_ENABLED: true };

function discover() {
  return runDiscoveryOrchestrator({
    runId: '11111111-1111-4111-8111-111111111111',
    researchQuery: 'Why do nuclear plants cost more to build in the United States?',
    plan: {},
    specialistAgentIds: ['story_verifier'],
    maxCoverageRounds: 2,
  });
}

const tierWrites = () => h.queries.filter((entry) => /authority_tier/.test(entry.sql));

describe('the authority tier through discovery', () => {
  beforeEach(() => {
    h.queries.length = 0;
    h.queued.length = 0;
    h.delays = { tavily: 0, crossref: 0, openalex: 0 };
    (config.discovery as Settings).enabled = true;
    (config.discovery as Settings).provider = 'tavily';
    (config.discovery as Settings).ingestionWaitTimeoutMs = 0;
  });
  afterEach(() => {
    Object.assign(config.discovery, discoveryWas);
  });

  it('sends the tier with the job when only the authority switch is on', async () => {
    h.delays = { tavily: 0, crossref: 20, openalex: 40 };
    await runWithFlags(TIERS_ON, discover);
    expect(h.queued).toHaveLength(1);
    // A DOI link alone is tier 3. One provider recorded a journal article: tier 2.
    expect(h.queued[0].authorityTier).toBe(2);
    // The citation lock is off, so no reference details travel.
    expect(h.queued[0].metadata).toEqual({ discovery_run_id: '11111111-1111-4111-8111-111111111111' });
  });

  it('sends the same tier whichever provider answers first', async () => {
    h.delays = { tavily: 40, crossref: 20, openalex: 0 };
    await runWithFlags(TIERS_ON, discover);
    expect(h.queued[0].authorityTier).toBe(2);
  });

  it('sends the same tier with the citation lock on as well', async () => {
    await runWithFlags(BOTH_ON, discover);
    expect(h.queued[0].authorityTier).toBe(2);
  });

  it('gives a source stored by an earlier run its tier, without replacing one it has', async () => {
    await runWithFlags(TIERS_ON, discover);
    expect(tierWrites()).toHaveLength(1);
    expect(tierWrites()[0].params).toEqual([STORED_ID, 2]);
    expect(tierWrites()[0].sql).toContain('COALESCE(authority_tier,');
  });

  it('sends and writes nothing about tiers with the switch off', async () => {
    const summary = await discover();
    expect(h.queued).toHaveLength(1);
    expect('authorityTier' in h.queued[0]).toBe(false);
    expect(tierWrites()).toHaveLength(0);
    expect(summary.sources.every((source) => !('authorityTier' in source))).toBe(true);
  });
});
