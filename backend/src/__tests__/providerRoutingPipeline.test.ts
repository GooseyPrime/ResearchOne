/**
 * Slice 7. Search providers chosen by what the request is about, through a whole
 * discovery pass with only the outside world replaced. With the switch off the
 * specialist mapping still decides and nothing about routing is written.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  calls: [] as Array<{ provider: string; query: string; hasOnFailure: boolean }>,
  events: [] as Array<{ phase: string; provider: string; query: string; payload: Record<string, unknown> }>,
  failing: new Set<string>(),
  /** Providers that fail the way the shipped ones do: log, tell `onFailure`, return []. */
  swallowing: new Set<string>(),
  plannerQueries: ['first planned query'] as string[],
  /** The gap planner's answer; 'fail' throws, as a planner with both models down does. */
  gapReply: '{"gaps":[],"queries":[],"done":true}' as string,
  gapPrompts: [] as string[],
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
    if (options.messages.some((message) => message.content.includes('GAP-FILLING'))) {
      h.gapPrompts.push(options.messages.map((message) => message.content).join('\n'));
      if (h.gapReply === 'fail') throw new Error('both planner models failed');
      return { content: h.gapReply, model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' };
    }
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
    async search(searchQuery: { text: string; onFailure?: (failure: unknown) => void }) {
      h.calls.push({ provider: name, query: searchQuery.text, hasOnFailure: 'onFailure' in searchQuery });
      if (h.swallowing.has(name)) {
        searchQuery.onFailure?.(Object.assign(new Error('timeout of 15000ms exceeded https://api.example.org/?key=secret-x'), { code: 'ECONNABORTED' }));
        return [];
      }
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

type Settings = { enabled: boolean; provider: string; ingestionWaitTimeoutMs: number; providerApiKey: string; tavilyApiKey: string; parallelApiKey: string; providerBaseUrl: string };
const was: Settings = {
  enabled: config.discovery.enabled,
  provider: config.discovery.provider,
  ingestionWaitTimeoutMs: config.discovery.ingestionWaitTimeoutMs,
  providerApiKey: config.discovery.providerApiKey,
  tavilyApiKey: config.discovery.tavilyApiKey,
  parallelApiKey: config.discovery.parallelApiKey,
  providerBaseUrl: config.discovery.providerBaseUrl,
};
const ROUTING_ON = { PROVIDER_ROUTING_ENABLED: true };
const ACADEMIC = ['arxiv', 'pmc', 'uspto', 'clinicaltrials'];

function discover(researchQuery: string, extra: { specialists?: string[]; intent?: string; layer2?: boolean; rounds?: number } = {}) {
  return runDiscoveryOrchestrator({
    runId: '11111111-1111-4111-8111-111111111111',
    researchQuery,
    plan: {},
    specialistAgentIds: extra.specialists ?? [],
    routingBrief: { intent: extra.intent ?? 'factual_report', layer2: extra.layer2 === true },
    maxCoverageRounds: extra.rounds ?? 2,
  });
}
const called = () => new Set(h.calls.map((call) => call.provider));

describe('choosing search providers by request', () => {
  beforeEach(() => {
    h.calls.length = 0;
    h.events.length = 0;
    h.failing.clear();
    h.swallowing.clear();
    h.gapReply = '{"gaps":[],"queries":[],"done":true}';
    h.gapPrompts.length = 0;
    h.plannerQueries = ['first planned query'];
    Object.assign(config.discovery, {
      enabled: true,
      provider: 'tavily',
      ingestionWaitTimeoutMs: 0,
      providerApiKey: '',
      tavilyApiKey: 'test-tavily',
      parallelApiKey: 'test-parallel',
      providerBaseUrl: 'https://search.example.org',
    });
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

  // Changed 8 Oct 2026 on Brandon's order: a scholarly-only service is not searched
  // for a request that is not scientific, medical, technical or about patents, with
  // the switch on or off. This case used to assert that the same market question
  // reached all four through the specialist mapping; that was the defect.
  it('without the switch, the specialist mapping no longer sends a market question to the scholarly-only services', async () => {
    await discover('Which subscription box niches have growing demand and few competitors?', {
      specialists: ['data_analysis_specialist', 'market_scout'],
      intent: 'opportunity_discovery',
    });
    for (const key of ACADEMIC) expect(called().has(key)).toBe(false);
    // The mapping's other services are searched as before.
    expect([...called()].sort()).toEqual(['parallel', 'tavily']);
    expect((h.events.find((event) => event.phase === 'providers_held_back')?.payload.held_back as string[]).sort()).toEqual([...ACADEMIC].sort());
  });

  it('without the switch, the specialist mapping still sends a medical question to the scholarly services on its route', async () => {
    await discover('What did the phase 3 clinical trials of semaglutide find in patients with obesity?', {
      specialists: ['data_analysis_specialist'],
      intent: 'survey',
    });
    for (const key of ['arxiv', 'pmc', 'clinicaltrials']) expect(called().has(key)).toBe(true);
    expect(called().has('uspto')).toBe(false);
  });

  it('sends the anomaly query on a challenge run, to every provider it searches, and searches Brave when keyed', async () => {
    config.discovery.providerApiKey = 'brave-key';
    config.discovery.provider = 'cascade';
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
    config.discovery.providerApiKey = 'brave-key';
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

  it('records a provider that reports its failure and returns nothing, as the shipped providers do', async () => {
    h.swallowing.add('crossref');
    await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?'));
    const errors = h.events.filter((event) => event.phase === 'provider_error');
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((event) => event.provider === 'crossref')).toBe(true);
    expect(errors[0].payload).toMatchObject({ error_kind: 'ECONNABORTED' });
    expect(JSON.stringify(errors)).not.toContain('secret-');
  });

  it('lets the planner choose the gap-filling queries from what was found, with no fixed words added', async () => {
    h.gapReply = '{"gaps":["no trial in adolescents"],"queries":["semaglutide adolescent obesity trial results"],"done":false}';
    await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?', { rounds: 3 }));
    expect(h.gapPrompts).toHaveLength(1);
    expect(h.gapPrompts[0]).toContain('PubMed Central: full-text biomedical');
    expect(h.calls.some((call) => call.query === 'semaglutide adolescent obesity trial results')).toBe(true);
    for (const fixed of ['monetization', 'demand signals', 'competitor reality']) expect(h.calls.some((call) => call.query.includes(fixed))).toBe(false);
    expect(h.events.find((event) => event.phase === 'plan_round_3')?.payload).toMatchObject({ gaps: ['no trial in adolescents'], done: false });
  });

  it('ends the gap-filling rounds when the planner finds nothing missing, or cannot be read, and records why', async () => {
    await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?', { rounds: 4 }));
    expect(h.gapPrompts).toHaveLength(1);
    expect(h.events.find((event) => event.phase === 'plan_round_3')?.payload).toMatchObject({ done: true });
    h.events.length = 0;
    h.gapPrompts.length = 0;
    h.gapReply = 'fail';
    const summary = await runWithFlags(ROUTING_ON, () => discover('What did the phase 3 clinical trials of semaglutide find?', { rounds: 4 }));
    expect(h.gapPrompts).toHaveLength(1);
    expect(h.events.find((event) => event.phase === 'plan_round_3')?.payload).toMatchObject({ failed: true });
    expect(summary.queriesExecuted).toEqual(['first planned query']);
  });

  it('without the switch, the gap-filling rounds still add the fixed phrases and ask no planner', async () => {
    await discover('What did the phase 3 clinical trials of semaglutide find?', { rounds: 3 });
    expect(h.gapPrompts).toHaveLength(0);
    expect(h.calls.some((call) => call.query === 'first planned query demand signals')).toBe(true);
  });

  it('leaves out a service with no key and records it as not configured', async () => {
    config.discovery.parallelApiKey = '';
    await runWithFlags(ROUTING_ON, () =>
      discover('Which subscription box niches have growing demand?', { intent: 'opportunity_discovery' })
    );
    expect(called().has('parallel')).toBe(false);
    expect(h.events.find((event) => event.phase === 'routing')?.payload.not_configured).toEqual(['parallel']);
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
    // The search request is the one it always was.
    expect(h.calls.every((call) => !call.hasOnFailure)).toBe(true);
  });
});
