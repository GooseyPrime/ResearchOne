/**
 * The relevance check on what discovery finds, through whole discovery passes
 * with only the outside world replaced: the search services, the model, the
 * database and the ingest queue.
 *
 * The fixtures are modelled on a report about election security that was
 * given three arXiv papers (home routers, IP cameras, foundation-model
 * transparency) and a voting-software vendor's sales page as sources. They
 * came in on shared general words: "secure", "security", "transparency",
 * "penetration testing".
 *
 * Each test here fails on the code before the check existed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

interface Found {
  url: string;
  title: string;
  snippet: string;
  score: number;
}

const h = vi.hoisted(() => ({
  /** What each search service returns, by service and then by query ('*' for any query). */
  results: {} as Record<string, Record<string, Array<{ url: string; title: string; snippet: string; score: number }>>>,
  calls: [] as Array<{ provider: string; query: string }>,
  events: [] as Array<{ phase: string; provider: string; payload: Record<string, unknown> }>,
  queued: [] as string[],
  /** Addresses the queue refuses. */
  refused: new Set<string>(),
  /** Every ingestion-job statement: the SQL and its values. */
  jobSql: [] as Array<{ sql: string; params: unknown[] }>,
  /** Addresses an earlier run already stored. */
  stored: new Set<string>(),
  /** What the stand-in judge says about an address. Anything not listed is relevant. */
  verdictByUrl: {} as Record<string, 'off_topic' | 'vendor_sales'>,
  /** 'down': both of the role's models fail. 'garbled': a reply that is not the JSON asked for. */
  judge: 'up' as 'up' | 'down' | 'garbled',
  judgeCalls: 0,
  gapReply: '{"gaps":[],"queries":[],"done":true}',
  gapPrompts: [] as string[],
  plannerQueries: ['2026 election security measures'] as string[],
}));

vi.mock('../db/pool', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    if (/INSERT INTO discovery_events/.test(sql)) {
      h.events.push({ phase: String(params[2]), provider: String(params[3]), payload: JSON.parse(String(params[7])) });
    }
    if (/ingestion_jobs/.test(sql)) h.jobSql.push({ sql, params });
    return [];
  }),
  queryOne: vi.fn(async (sql: string, params: unknown[] = []) =>
    /FROM sources WHERE url/.test(sql) && h.stored.has(String(params[0])) ? { id: 'stored-source' } : null
  ),
  withTransaction: vi.fn(),
  adminQuery: vi.fn(async () => []),
}));
vi.mock('../queue/queues', () => ({
  ingestionQueue: {
    add: vi.fn(async (_name: string, job: { url: string }) => {
      if (h.refused.has(job.url)) throw new Error('queue unavailable');
      h.queued.push(job.url);
    }),
  },
  embeddingQueue: { add: vi.fn() },
}));
vi.mock('axios', () => {
  const head = vi.fn(async () => ({ status: 200 }));
  return { default: { head, get: vi.fn(), post: vi.fn(), create: () => ({ head, get: vi.fn(), post: vi.fn() }) } };
});
vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(async (options: { messages: Array<{ content: string }> }) => {
    const reply = (content: string) => ({ content, model: 'test', role: 'planner', promptTokens: 1, completionTokens: 1, durationMs: 1, usedFallback: false, primaryModel: 'test' });
    const text = options.messages.map((message) => message.content).join('\n');
    if (text.includes('Items to judge')) {
      h.judgeCalls += 1;
      // The error a call throws once its primary and its fallback have both failed. Its message carries a request address.
      if (h.judge === 'down') throw Object.assign(new Error('POST https://openrouter.example/v1/chat?key=secret-judge-key failed'), { code: 'ECONNRESET' });
      if (h.judge === 'garbled') return reply('I could not decide on these.');
      const items = JSON.parse(text.slice(text.indexOf('[', text.indexOf('Items to judge')), text.lastIndexOf(']') + 1)) as Array<{ n: number; address: string }>;
      return reply(JSON.stringify({
        verdicts: items.map((item) => ({ n: item.n, verdict: h.verdictByUrl[item.address] ?? 'relevant', why: h.verdictByUrl[item.address] ? 'about a different subject' : 'about the question' })),
      }));
    }
    if (text.includes('GAP-FILLING')) {
      h.gapPrompts.push(text);
      return reply(h.gapReply);
    }
    if (text.includes('Round 1 candidates')) return reply('{"rationale":"covered","follow_up_queries":[],"exclusion_patterns":[]}');
    return reply(JSON.stringify({
      need_external_discovery: true,
      rationale: 'r',
      discovery_queries: h.plannerQueries,
      target_source_types: [],
      preferred_evidence_tiers: [],
      max_sources_to_ingest: 5,
      exclusion_patterns: [],
      disconfirming_evidence_criteria: '',
    }));
  }),
  getSystemPrompt: () => '',
}));

function fakeProvider(name: string) {
  return class {
    readonly name = name;
    async search(searchQuery: { text: string }) {
      h.calls.push({ provider: name, query: searchQuery.text });
      const mine = h.results[name] ?? {};
      return (mine[searchQuery.text] ?? mine['*'] ?? []).map((found, at) => ({
        ...found,
        rank: at + 1,
        provider: name,
        sourceQuery: searchQuery.text,
      }));
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
import { config, runWithFlags } from '../config';
import { forgetRunVerdicts, NOT_USED_LABEL, NOT_USED_VENDOR_LABEL, type RelevanceCheckReport } from '../services/discovery/relevanceGate';

const RUN = '22222222-2222-4222-8222-222222222222';
const QUESTION =
  'What is being done to secure election data and voting practices for the 2026 United States elections? ' +
  'Will these measures be effective, or are they geared to securing an advantage for the party in power?';

// The four sources that should never have been used, described as their own titles and summaries describe them.
// The first shares two of the question's words ("securing", "secure"), which was the old check's whole bar.
const IOT: Found = {
  url: 'https://arxiv.org/pdf/2210.02137',
  title: "Internet Service Providers' and Individuals' Attitudes, Barriers, and Incentives to Secure IoT",
  snippet: 'ISPs and individual users play a vital role in securing the Internet of Things. We study their attitudes towards IoT security, the obstacles they face and their incentives to keep devices secure.',
  score: 1,
};
const TRANSPARENCY: Found = {
  url: 'https://arxiv.org/pdf/2512.10169',
  title: 'The 2025 Foundation Model Transparency Index',
  snippet: 'We score the major foundation model developers on how transparent they are about training data, compute and downstream use.',
  score: 1,
};
const CAMERAS: Found = {
  url: 'https://arxiv.org/pdf/2202.06597',
  title: 'Vulnerability Assessment and Penetration Testing on IP cameras',
  snippet: 'We carry out a vulnerability assessment and penetration testing of IP cameras and report the weaknesses found in the devices.',
  score: 1,
};
const VENDOR: Found = {
  url: 'https://www.simplyvoting.com/security/',
  title: 'Secure Online Voting Software | Simply Voting',
  snippet: 'Secure online voting software for your next election. Request a demo and see pricing.',
  score: 0.92,
};
const OFF_TOPIC = [IOT, TRANSPARENCY, CAMERAS, VENDOR];

const EAC: Found = {
  url: 'https://www.eac.gov/news/2025/11/election-security-update',
  title: 'EAC update on election security preparations for 2026',
  snippet: 'The Election Assistance Commission describes voting system testing and certification ahead of the 2026 election.',
  score: 0.8,
};
const CISA: Found = {
  url: 'https://www.cisa.gov/topics/election-security',
  title: 'Election Security | CISA',
  snippet: 'What CISA is doing to secure election infrastructure and voter registration data.',
  score: 0.78,
};
const PENNSYLVANIA: Found = {
  url: 'https://www.pa.gov/agencies/dos/voting-system-security-standard-2026',
  title: 'Pennsylvania 2026 voting-system security standard',
  snippet: 'The standard every voting system in Pennsylvania must meet for the 2026 election.',
  score: 0.75,
};
const ON_TOPIC = [EAC, CISA, PENNSYLVANIA];

type Settings = { enabled: boolean; provider: string; ingestionWaitTimeoutMs: number; providerApiKey: string; tavilyApiKey: string; providerBaseUrl: string };
const was: Settings = {
  enabled: config.discovery.enabled,
  provider: config.discovery.provider,
  ingestionWaitTimeoutMs: config.discovery.ingestionWaitTimeoutMs,
  providerApiKey: config.discovery.providerApiKey,
  tavilyApiKey: config.discovery.tavilyApiKey,
  providerBaseUrl: config.discovery.providerBaseUrl,
};
const gateSetting = process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;

const reports: RelevanceCheckReport[] = [];
function discover(extra: { specialists?: string[]; minUsableSources?: number; question?: string; intent?: string } = {}) {
  return runDiscoveryOrchestrator({
    runId: RUN,
    researchQuery: extra.question ?? QUESTION,
    plan: {},
    // A plan for this kind of report schedules this specialist; the mapping ties it to the four scholarly services.
    specialistAgentIds: extra.specialists ?? ['timeline_reconstructor', 'quantitative_quality_auditor'],
    routingBrief: { intent: extra.intent ?? 'timeline', layer2: false },
    minUsableSources: extra.minUsableSources,
    maxCoverageRounds: 2,
    onRelevanceCheck: (report) => { reports.push(report); },
  });
}
const called = () => new Set(h.calls.map((call) => call.provider));
const gateEvents = () => h.events.filter((event) => event.phase === 'relevance_gate');
const notUsedInRecord = () =>
  gateEvents().flatMap((event) => event.payload.not_used as Array<{ url: string; title: string; reason: string; decided_by: string; why: string }>);

describe('the relevance check before ingest', () => {
  beforeEach(() => {
    h.results = {};
    h.calls.length = 0;
    h.events.length = 0;
    h.queued.length = 0;
    h.refused.clear();
    h.jobSql.length = 0;
    h.stored.clear();
    h.verdictByUrl = Object.fromEntries([IOT, TRANSPARENCY, CAMERAS].map((found) => [found.url, 'off_topic'] as const));
    h.verdictByUrl[VENDOR.url] = 'vendor_sales';
    h.judge = 'up';
    h.judgeCalls = 0;
    h.gapReply = '{"gaps":[],"queries":[],"done":true}';
    h.gapPrompts.length = 0;
    h.plannerQueries = ['2026 election security measures'];
    reports.length = 0;
    forgetRunVerdicts();
    delete process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;
    Object.assign(config.discovery, {
      enabled: true,
      provider: 'tavily',
      ingestionWaitTimeoutMs: 0,
      providerApiKey: '',
      tavilyApiKey: 'test-tavily',
      providerBaseUrl: '',
    });
  });
  afterEach(() => {
    Object.assign(config.discovery, was);
    if (gateSetting === undefined) delete process.env.DISCOVERY_RELEVANCE_GATE_ENABLED;
    else process.env.DISCOVERY_RELEVANCE_GATE_ENABLED = gateSetting;
  });

  it('does not ingest a candidate judged off-topic, and records each one with the reason', async () => {
    // Found by the general web search here, since the scholarly services are no longer asked.
    h.results = { tavily: { '*': [...OFF_TOPIC, ...ON_TOPIC] } };
    // A plan that asks for 15 sources. That number is the floor the old check
    // topped up to with whatever it had called off-topic.
    const summary = await discover({ minUsableSources: 15 });

    for (const found of OFF_TOPIC) expect(h.queued).not.toContain(found.url);
    expect([...h.queued].sort()).toEqual(ON_TOPIC.map((found) => found.url).sort());

    const recorded = notUsedInRecord();
    expect(recorded.map((entry) => entry.url).sort()).toEqual(OFF_TOPIC.map((found) => found.url).sort());
    for (const entry of recorded) {
      expect(entry.decided_by).toBe('model');
      expect(entry.why).toBe('about a different subject');
      expect(entry.title).toBeTruthy();
    }
    expect(recorded.find((entry) => entry.url === IOT.url)?.reason).toBe('off_topic');
    // A company's own sales page is not evidence, and is recorded as that, not as off-topic.
    expect(recorded.find((entry) => entry.url === VENDOR.url)?.reason).toBe('vendor_sales');

    // The run's own summary says the same, in the words the diagnostics view shows.
    const inSummary = (url: string) => summary.sources.find((source) => source.url === url);
    expect(inSummary(IOT.url)).toMatchObject({ ingested: false, skipReason: 'not_relevant', selectionRationale: NOT_USED_LABEL });
    expect(inSummary(VENDOR.url)).toMatchObject({ ingested: false, skipReason: 'vendor_sales', selectionRationale: NOT_USED_VENDOR_LABEL });
    expect(summary.sourcesIngested).toBe(ON_TOPIC.length);
    expect(reports[0]).toMatchObject({ judged: 7, relevant: 3, notUsed: 4, decidedWithoutModel: 0 });
  });

  it('closes the job row as failed when a relevant result cannot be queued', async () => {
    h.results = { tavily: { '*': [...ON_TOPIC] } };
    const refused = ON_TOPIC[0];
    h.refused.add(refused.url);
    const summary = await discover({ minUsableSources: 15 });

    const inserted = h.jobSql.find((entry) => /INSERT INTO ingestion_jobs/.test(entry.sql) && entry.params[1] === refused.url);
    expect(inserted).toBeTruthy();
    const closed = h.jobSql.filter((entry) => /UPDATE ingestion_jobs SET status = 'failed'/.test(entry.sql));
    // Only the refused one, by its own id, and only while it still says queued.
    expect(closed).toHaveLength(1);
    expect(closed[0].params[1]).toBe(inserted?.params[0]);
    expect(closed[0].sql).toMatch(/AND status = 'queued'/);
    expect(String(closed[0].params[0])).toContain('queue unavailable');

    expect(h.queued).not.toContain(refused.url);
    expect(summary.sources.find((source) => source.url === refused.url)).toMatchObject({ ingested: false, skipReason: 'queue_error' });
    expect(summary.sourcesIngested).toBe(ON_TOPIC.length - 1);
  });

  it('keeps a vendor page when the judge finds the question is about that vendor', async () => {
    h.results = { tavily: { '*': [VENDOR, EAC] } };
    delete h.verdictByUrl[VENDOR.url];
    await discover({ question: 'How does Simply Voting secure the ballots cast on its online voting platform?' });
    expect(h.queued).toContain(VENDOR.url);
  });

  it('judges candidates in batches, not one call each', async () => {
    const many = Array.from({ length: 40 }, (_, at) => ({ ...EAC, url: `https://www.eac.gov/news/item-${at}`, score: 0.5 }));
    h.results = { tavily: { '*': many } };
    await discover();
    expect(h.judgeCalls).toBe(2);
    expect(h.queued.length).toBeGreaterThan(0);
  });

  it('does not send a civic question to arXiv, PubMed Central, ClinicalTrials.gov or the patent office, with provider routing off', async () => {
    await discover();
    for (const key of ['arxiv', 'pmc', 'clinicaltrials', 'uspto']) expect(called().has(key)).toBe(false);
    expect(called().has('tavily')).toBe(true);
    // The specialist mapping still adds the services that cover every field.
    expect(called().has('openalex')).toBe(true);
    const heldBack = h.events.find((event) => event.phase === 'providers_held_back');
    expect((heldBack?.payload.held_back as string[]).sort()).toEqual(['arxiv', 'clinicaltrials', 'pmc', 'uspto']);
    expect(heldBack?.payload.routes).toEqual(['default']);
  });

  it('does not send a civic question to them with provider routing on either', async () => {
    await runWithFlags({ PROVIDER_ROUTING_ENABLED: true }, () => discover());
    for (const key of ['arxiv', 'pmc', 'clinicaltrials', 'uspto']) expect(called().has(key)).toBe(false);
  });

  it('still sends a medical question to the scholarly services its route uses, with routing off', async () => {
    await discover({
      question: 'What did the phase 3 clinical trials of semaglutide find in patients with obesity?',
      specialists: ['quantitative_quality_auditor'],
      intent: 'survey',
    });
    for (const key of ['arxiv', 'pmc', 'clinicaltrials']) expect(called().has(key)).toBe(true);
    // Not a question about patents.
    expect(called().has('uspto')).toBe(false);
  });

  it('runs a model-planned gap-filling round when the check leaves the run short, and checks what that round finds', async () => {
    const GAP_QUERY = 'state election officials 2026 voting system certification';
    const FOUND_LATER: Found = {
      url: 'https://www.nass.org/2026-election-security-briefing',
      title: 'State election officials on 2026 election security',
      snippet: 'Secretaries of state describe certification and audits for the 2026 election.',
      score: 0.7,
    };
    const ANOTHER_PAPER: Found = { ...CAMERAS, url: 'https://arxiv.org/pdf/2301.00001' };
    h.verdictByUrl[ANOTHER_PAPER.url] = 'off_topic';
    h.results = { tavily: { [h.plannerQueries[0]]: [...OFF_TOPIC, EAC], [GAP_QUERY]: [FOUND_LATER, ANOTHER_PAPER] } };
    h.gapReply = JSON.stringify({ gaps: ['nothing from state election officials'], queries: [GAP_QUERY], done: false });
    // Round 1 spends the whole ordinary query budget, as it usually does.
    const queryBudgetWas = config.discovery.maxQueriesPerRun;
    config.discovery.maxQueriesPerRun = 1;
    try {
      const summary = await discover({ minUsableSources: 3 });

      // The planner was asked, and shown only what was relevant. The run was still
      // one short after the round, so it was asked once more; it had no new
      // search to offer and the rounds ended there.
      expect(h.gapPrompts).toHaveLength(2);
      expect(h.gapPrompts[1]).toContain(FOUND_LATER.url);
      expect(h.gapPrompts[0]).toContain(EAC.url);
      expect(h.gapPrompts[0]).not.toContain(IOT.url);
      // Its query was searched although the ordinary budget was spent.
      expect(h.calls.some((call) => call.query === GAP_QUERY)).toBe(true);
      expect(summary.queriesExecuted).toEqual([h.plannerQueries[0], GAP_QUERY]);
      // What it found went through the same check.
      expect(h.queued).toContain(FOUND_LATER.url);
      expect(h.queued).not.toContain(ANOTHER_PAPER.url);
      expect(notUsedInRecord().map((entry) => entry.url)).toContain(ANOTHER_PAPER.url);
      // No fixed words were added to the search.
      for (const fixed of ['monetization', 'demand signals', 'competitor reality']) {
        expect(h.calls.some((call) => call.query.includes(fixed))).toBe(false);
      }
      expect(h.events.find((event) => event.phase === 'relevance_shortfall')?.payload).toMatchObject({ usable: 1, needed: 3, set_aside: 4 });
    } finally {
      config.discovery.maxQueriesPerRun = queryBudgetWas;
    }
  });

  it('runs no gap-filling round when the check set nothing aside', async () => {
    h.results = { tavily: { '*': [EAC] } };
    h.gapReply = JSON.stringify({ gaps: ['x'], queries: ['another search'], done: false });
    await discover({ minUsableSources: 3 });
    expect(h.gapPrompts).toHaveLength(0);
  });

  it('counts a relevant source that is already stored as usable, and queues nothing for it', async () => {
    h.results = { tavily: { '*': [IOT, EAC, CISA, PENNSYLVANIA] } };
    h.stored.add(EAC.url);
    h.gapReply = JSON.stringify({ gaps: ['x'], queries: ['another search'], done: false });
    const summary = await discover({ minUsableSources: 3 });
    expect(h.queued).not.toContain(EAC.url);
    expect(summary.sources.find((source) => source.url === EAC.url)?.skipReason).toBe('already_in_corpus');
    // Two queued and one already stored make the three the run needs: no extra round.
    expect(h.gapPrompts).toHaveLength(0);
  });

  describe('when no model can judge', () => {
    for (const mode of ['down', 'garbled'] as const) {
      it(`keeps the run going, records it, and does not ingest everything (judge ${mode})`, async () => {
        h.judge = mode;
        // No shared wording with the question at all.
        const UNRELATED: Found = {
          url: 'https://example.org/sourdough-starter',
          title: 'How to keep a sourdough starter alive',
          snippet: 'Flour, water and patience.',
          score: 0.99,
        };
        h.results = { tavily: { '*': [UNRELATED, IOT, EAC, CISA, PENNSYLVANIA] } };

        const summary = await discover({ minUsableSources: 15 });

        // The run went on and has sources.
        expect(summary.sourcesIngested).toBeGreaterThan(0);
        expect(h.queued).toContain(EAC.url);
        expect(h.queued).toContain(PENNSYLVANIA.url);
        // It did not fall back to taking everything, even though the plan's floor of 15 was not met.
        expect(h.queued).not.toContain(UNRELATED.url);
        expect(h.queued.length).toBeLessThan(5);

        // The record says a model did not decide, and how it failed. Nothing of the failure's message is kept.
        const event = gateEvents()[0];
        expect(event.payload.decided_without_model).toBe(5);
        expect(event.payload.failure_kinds).toEqual([mode === 'down' ? 'ECONNRESET' : 'unreadable_reply']);
        expect(JSON.stringify(h.events)).not.toContain('secret-judge-key');
        expect(JSON.stringify(h.events)).not.toContain('openrouter.example');
        for (const entry of notUsedInRecord()) expect(entry.decided_by).toBe('word_overlap');

        // The run's trace is told, so the degraded check is visible.
        expect(reports[0].decidedWithoutModel).toBe(5);
      });
    }

    it('asks for more than two shared general words: the paper that got in on "secure" and "data" stays out', async () => {
      h.judge = 'down';
      h.results = { tavily: { '*': [IOT, EAC] } };
      await discover();
      expect(h.queued).toEqual([EAC.url]);
    });
  });

  it('with the emergency switch off, runs no judge and behaves as before the check', async () => {
    process.env.DISCOVERY_RELEVANCE_GATE_ENABLED = 'false';
    h.results = { tavily: { '*': [...OFF_TOPIC, ...ON_TOPIC] } };
    await discover({ minUsableSources: 15 });
    expect(h.judgeCalls).toBe(0);
    expect(gateEvents()).toHaveLength(0);
    // The old word-overlap check alone: the unrelated sources are ingested again.
    expect(h.queued).toContain(IOT.url);
  });

  it('is on when the setting is absent, and for any value but "false"', async () => {
    h.results = { tavily: { '*': [IOT, EAC] } };
    await discover();
    expect(h.judgeCalls).toBe(1);
    process.env.DISCOVERY_RELEVANCE_GATE_ENABLED = 'yes';
    h.judgeCalls = 0;
    forgetRunVerdicts();
    await discover();
    expect(h.judgeCalls).toBe(1);
  });
});
