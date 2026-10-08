/**
 * Slice 7. Search providers chosen by what the request is about, through a whole
 * discovery pass with only the outside world replaced. With the switch off the
 * specialist mapping still decides and nothing about routing is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ provider: string; query: string }>,
  events: [] as Array<{ phase: string; provider: string; query: string; payload: Record<string, unknown> }>,
  failing: new Set<string>(),
  plannerQueries: ['first planned query'] as string[],
}));

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO discovery_events/.test(sql)) {
      h.events.push({ phase: String(params[2]), provider: String(params[3]), query: String(params[4]), payload: JSON.parse(String(params[7])) });
    }
    return [];
  }),
  queryOne: vi.fn(async () => null),
  withTransaction: vi.fn(),
  adminQuery: vi.fn(async () => []),
}));
vi.mock('../queue/queues', () => ({ ingestionQueue: { add: vi.fn(async () => undefined) }, embeddingQueue: { add: vi.fn() } }));
vi.mock('axios', () => {
  const head = vi.fn(async () => ({ status: 200 }));
  return { default: { head, get: vi.fn(), post: vi.fn(), create: () => ({ head, get: vi.fn(), post: vi.fn() }) } };
});
vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
    const followUp = options.messages.some((message) => message.content.includes('Round 1 candidates'));
    const content = followUp
      ? '{"rationale":"covered","follow_up_queries":[],"exclusion_patterns":[]}'
      : JSON.stringify({
          need_external_discovery: true,
          rationale: 'r',
          discovery_queries: h.plannerQueries,
          target_source_types: [],
          preferred_evidence_tiers: [],
          max_sources_to_ingest: 5,
          exclusion_patterns: [],
          disconfirming_evidence_criteria: '',
        });
    return { content, model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
  }),
  getSystemPrompt: () => '',
}));

function fakeProvider(name: string) {
  return class {
    readonly name = name;
    async search(searchQuery: { text: string }) {
      h.calls.push({ provider: name, query: searchQuery.text });
      if (h.failing.has(name)) throw Object.assign(new Error(`GET https://api.example.org/?key=secret-${name} failed`), { code: 'ECONNRESET' });
      return [];
    }
  };
}
vi.mock('../services/discovery/providers/tavilySearch', () => ({ TavilySearchProvider: fakeProvider('tavily') }));
vi.mock('../services/discovery/providers/braveSearch', () => ({ BraveSearchProvider: fakeProvider('brave') }));
vi.mock('../services/discovery/providers/genericWebSearch', () => ({ GenericWebSearchProvider: fakeProvider('generic') }));
vi.mock('../services/discovery/providers/parallelSearch', () => ({ ParallelSearchProvider: fakeProvider('parallel') }));
vi.mock('../services/discovery/providers/openAlexSearch', () => ({ OpenAlexSearchProvider: fakeProvider('openalex') }));
vi.mock('../services/discovery/providers/crossrefSearch', () => ({ CrossrefSearchProvider: fakeProvider('crossref') }));
vi.mock('../services/discovery/providers/arxivSearch', () => ({ ArxivSearchProvider: fakeProvider('arxiv') }));
vi.mock('../services/discovery/providers/pubmedCentralSearch', () => ({ PubmedCentralSearchProvider: fakeProvider('pmc') }));
vi.mock('../services/discovery/providers/usptoSearch', () => ({ UsptoSearchProvider: fakeProvider('uspto') }));
vi.mock('../services/discovery/providers/clinicalTrialsSearch', () => ({ ClinicalTrialsSearchProvider: fakeProvider('clinicaltrials') }));

import { runDiscoveryOrchestrator } from '../services/discovery/discoveryOrchestrator';
import { config, discoveryIngestFloor, discoveryQueryBudget, runWithFlags } from '../config';
import { ANOMALY_QUERY_SUFFIX } from '../services/discovery/deterministicDiscoveryQueries';

type Settings = { enabled: boolean; provider: string; ingestionWaitTimeoutMs: number; providerApiKey: string };
const was: Settings = {
  enabled: config.discovery.enabled,
  provider: config.discovery.provider,
  ingestionWaitTimeoutMs: config.discovery.ingestionWaitTimeoutMs,
  providerApiKey: config.discovery.providerApiKey,
};
const ROUTING_ON = { PROVIDER_ROUTING_ENABLED: true };
const ACADEMIC = ['arxiv', 'pmc', 'uspto', 'clinicaltrials'];

function discover(researchQuery: string, extra: { specialists?: string[]; intent?: string; layer2?: boolean } = {}) {
  return runDiscoveryOrchestrator({
    runId: '11111111-1111-4111-8111-111111111111',
    researchQuery,
    plan: {},
    specialistAgentIds: extra.specialists ?? [],
    routingBrief: { intent: extra.intent ?? 'factual_report', layer2: extra.layer2 === true },
    maxCoverageRounds: 2,
  });
}
const called = () => new Set(h.calls.map((call) => call.provider));

describe('choosing search providers by request', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.events.length = 0;
    h.failing.clear();
    h.plannerQueries = ['first planned query'];
    Object.assign(config.discovery, { enabled: true, provider: 'tavily', ingestionWaitTimeoutMs: 0, providerApiKey: '' });
  });
  afterEach(() => {
    Object.assign(config.discovery, was);
  });

  it('does not search the patent office for a clinical question', async () => {
    await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find in patients with obesity?'));
    expect(called().has('uspto')).toBe(false);
    for (const key of ['openalex', 'crossref', 'pmc', 'clinicaltrials', 'arxiv', 'tavily']) expect(called().has(key)).toBe(true);
  });

  it('keeps a market question away from arXiv and PubMed Central even when a data-analysis specialist is scheduled', async () => {
    await runWithFlags(ROUTING_ON, () =>
      discover('Which subscription box niches have growing demand and few competitors?', {
        specialists: ['data_analysis_specialist', 'market_scout'],
        intent: 'opportunity_discovery',
      })
    );
    for (const key of ACADEMIC) expect(called().has(key)).toBe(false);
    expect([...called()].sort()).toEqual(['parallel', 'tavily']);
  });

  it('without the switch, the same run reaches the academic providers through the specialist mapping', async () => {
    await discover('Which subscription box niches have growing demand and few competitors?', {
      specialists: ['data_analysis_specialist', 'market_scout'],
      intent: 'opportunity_discovery',
    });
    for (const key of ACADEMIC) expect(called().has(key)).toBe(true);
  });

  it('sends the anomaly query on a challenge run, to every provider it searches, and searches Brave when keyed', async () => {
    config.discovery.providerApiKey = 'brave-key';
    await runWithFlags(ROUTING_ON, () =>
      discover('Did the 2019 vaping illness outbreak come from nicotine products?', { intent: 'investigation', layer2: true })
    );
    const anomaly = h.calls.filter((call) => call.query.endsWith(ANOMALY_QUERY_SUFFIX));
    expect(anomaly.length).toBeGreaterThan(0);
    expect(new Set(anomaly.map((call) => call.provider))).toEqual(called());
    expect(called().has('brave')).toBe(true);
    const routing = h.events.find((event) => event.phase === 'routing');
    expect((routing?.payload.extra_queries as Array<{ purpose: string }>).map((extra) => extra.purpose)).toContain('anomaly');
  });

  it('sends no anomaly query on an ordinary run', async () => {
    await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?'));
    expect(h.calls.some((call) => call.query.endsWith(ANOMALY_QUERY_SUFFIX))).toBe(false);
    expect(called().has('brave')).toBe(false);
  });

  it('sends the GitHub query for a code question only to the web providers', async () => {
    config.discovery.provider = 'cascade';
    await runWithFlags(ROUTING_ON, () => discover('Which open-source libraries parse PDF tables well?'));
    const github = h.calls.filter((call) => call.query.endsWith('site:github.com'));
    expect(new Set(github.map((call) => call.provider))).toEqual(new Set(['tavily', 'brave', 'generic']));
  });

  it('records a failing provider with the run and goes on with the others', async () => {
    h.failing.add('openalex');
    const summary = await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?'));
    const errors = h.events.filter((event) => event.phase === 'provider_error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((event) => event.provider === 'openalex')).toBe(true);
    expect(errors[0].payload).toMatchObject({ error_kind: 'ECONNRESET' });
    // The message carried a request address with a key in it; nothing of it is kept.
    expect(JSON.stringify(errors)).not.toContain('secret-');
    expect(called().has('crossref')).toBe(true);
    expect(summary.queriesExecuted.length).toBeGreaterThan(0);
  });

  it('uses the raised query budget with the switch on, and the old one without it', async () => {
    h.plannerQueries = Array.from({ length: 20 }, (_, at) => `planned query number ${at + 1}`);
    const routed = await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?'));
    expect(routed.queriesExecuted).toHaveLength(12);
    const plain = await discover('What did the phase 3 clinical trials of semaglutide find?');
    expect(plain.queriesExecuted).toHaveLength(5);
    expect(runWithFlags(ROUTING_ON, discoveryQueryBudget)).toBe(12);
    expect(runWithFlags(ROUTING_ON, discoveryIngestFloor)).toBe(24);
    expect(discoveryIngestFloor()).toBe(config.discovery.maxIngestPerRun);
  });

  it('writes nothing about routing and sends the planned queries unchanged with the switch off', async () => {
    const summary = await discover('Did the 2019 vaping illness outbreak come from nicotine products?', { intent: 'investigation', layer2: true });
    expect(h.events.some((event) => event.phase === 'routing' || event.phase === 'provider_error')).toBe(false);
    expect(summary.queriesExecuted).toEqual(['first planned query']);
    expect([...called()]).toEqual(['tavily']);
  });
});
