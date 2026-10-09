/**
 * Slice 7. The routing table, the extra queries and the reference lookup's writer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { routesFor, selectProviders, sourceDescriptionsFor } from '../services/discovery/providerRouting';
import { PROVIDER_KEYS, PROVIDER_REGISTRY } from '../services/discovery/providerRegistry';
import { config } from '../config';
import { providerErrorRecord, withExtraQueries } from '../services/discovery/discoveryOrchestrator';
import { anomalyQueryFor, searchSeedFor } from '../services/discovery/deterministicDiscoveryQueries';
import { getOrchestrationProfileForIntent } from '../services/planning/orchestrationProfiles';

const unkeyed = new Set(['brave']);
const WEB = { webProviders: ['tavily'] as const, isConfigured: (key: string) => !unkeyed.has(key) };
const ALL_KEYED = { isConfigured: () => true };
const brief = (researchQuery: string, extra: { intent?: string; objective?: string; layer2?: boolean } = {}) => ({
  researchQuery,
  intent: extra.intent ?? 'factual_report',
  researchObjective: extra.objective ?? null,
  layer2: extra.layer2 === true,
  seed: 'seed terms',
});

describe('routes', () => {
  it('sends a scientific or medical question to the scholarly indexes first, then the web', () => {
    const chosen = selectProviders(brief('Does metformin lower cancer risk in patients with diabetes?'), WEB);
    expect(chosen.routes).toEqual(['scientific']);
    expect(chosen.providers).toEqual(['openalex', 'crossref', 'pmc', 'clinicaltrials', 'arxiv', 'tavily']);
    expect(chosen.extraQueries).toEqual([]);
  });

  it('sends a patent question to the patent office', () => {
    expect(selectProviders(brief('Who holds prior art on solid-state battery separators?'), WEB).providers).toEqual(['uspto', 'openalex', 'tavily']);
    expect(routesFor({ researchQuery: 'battery separators', researchObjective: 'PATENT_GAP_ANALYSIS' })).toEqual(['patent']);
  });

  it('keeps a market question on Parallel and the web, unless the request is itself technical', () => {
    expect(selectProviders(brief('Which pet supplement niches have rising demand?', { intent: 'opportunity_discovery' }), WEB).providers).toEqual(['parallel', 'tavily']);
    const technical = selectProviders(brief('Market demand for CRISPR diagnostic kits in clinical labs'), WEB);
    expect(technical.routes).toEqual(['scientific', 'market']);
    expect(technical.providers).toContain('arxiv');
  });

  it('adds a GitHub query for a code question, for the web providers only', () => {
    const chosen = selectProviders(brief('Compare open-source libraries for vector search'), { webProviders: ['tavily', 'brave', 'generic'], ...ALL_KEYED });
    expect(chosen.routes).toEqual(['code']);
    expect(chosen.extraQueries).toEqual([{ text: 'seed terms site:github.com', providers: ['tavily', 'brave', 'generic'], purpose: 'repository' }]);
  });

  it('by default searches the web and two scholarly indexes, with one query aimed at official records', () => {
    const chosen = selectProviders(brief('When was the Brooklyn Bridge completed?'), WEB);
    expect(chosen.routes).toEqual(['default']);
    expect(chosen.providers).toEqual(['tavily', 'openalex', 'crossref']);
    expect(chosen.extraQueries.map((extra) => extra.purpose)).toEqual(['official_record']);
    expect(chosen.extraQueries[0].providers).toEqual(['tavily']);
  });

  it('on a challenge run adds Brave when keyed and the anomaly query for every provider', () => {
    const keyed = selectProviders(brief('Did the 1977 Wow! signal have a terrestrial origin?', { layer2: true }), { ...WEB, ...ALL_KEYED });
    expect(keyed.providers).toContain('brave');
    const anomaly = keyed.extraQueries.find((extra) => extra.purpose === 'anomaly');
    expect(anomaly?.text).toBe(anomalyQueryFor('seed terms'));
    expect(anomaly?.providers).toEqual(keyed.providers);
    expect(selectProviders(brief('Same question', { layer2: true }), WEB).providers).not.toContain('brave');
  });
});

describe('the provider registry', () => {
  it('a service whose key is not set sits out and is listed as not configured', () => {
    const chosen = selectProviders(brief('Which pet supplement niches have rising demand?', { intent: 'opportunity_discovery' }), {
      webProviders: ['tavily'],
      isConfigured: (key) => key !== 'parallel',
    });
    expect(chosen.providers).toEqual(['tavily']);
    expect(chosen.notConfigured).toEqual(['parallel']);
  });

  it('every registered service is described in the provider guide', () => {
    const guide = readFileSync(join(__dirname, '../../../docs/SEARCH_PROVIDERS.md'), 'utf8');
    for (const key of PROVIDER_KEYS) {
      const entry = PROVIDER_REGISTRY[key];
      expect(guide, key).toContain(`### ${entry.title} (\`${key}\`)`);
      for (const setting of entry.needs) expect(guide, key).toContain(setting);
    }
  });

  it('every registered service can be built and searches under its own key', () => {
    for (const key of PROVIDER_KEYS) expect(PROVIDER_REGISTRY[key].build().name).toBe(key);
  });

  it('tells the gap planner what each searched source covers', () => {
    expect(sourceDescriptionsFor(['pmc'])).toBe(`PubMed Central: ${PROVIDER_REGISTRY.pmc.covers}`);
  });
});

describe('review findings', () => {
  it('puts the anomaly query first, so a tight budget keeps it', () => {
    const chosen = selectProviders(brief('When was the Brooklyn Bridge completed?', { layer2: true }), WEB);
    expect(chosen.extraQueries.map((extra) => extra.purpose)).toEqual(['anomaly', 'official_record']);
    const round1 = withExtraQueries(['planned'], chosen.extraQueries.map((extra) => extra.text), 2);
    expect(round1).toEqual(['planned', anomalyQueryFor('seed terms')]);
  });

  it('never treats the generic endpoint key as a Brave key', () => {
    const was = { provider: config.discovery.provider, providerApiKey: config.discovery.providerApiKey };
    Object.assign(config.discovery, { provider: 'generic', providerApiKey: 'generic-endpoint-key' });
    expect(PROVIDER_REGISTRY.brave.isConfigured()).toBe(false);
    expect(selectProviders(brief('Same question', { layer2: true }), { webProviders: ['generic'] }).providers).not.toContain('brave');
    Object.assign(config.discovery, { provider: 'cascade' });
    expect(PROVIDER_REGISTRY.brave.isConfigured()).toBe(true);
    Object.assign(config.discovery, was);
  });
});

describe('extra queries', () => {
  it('fits the extras inside the budget and always runs a planned query', () => {
    expect(withExtraQueries(['a', 'b', 'c'], ['x'], 3)).toEqual(['a', 'b', 'x']);
    expect(withExtraQueries(['a', 'b'], ['x', 'y'], 1)).toEqual(['a']);
    expect(withExtraQueries(['a'], ['a', 'x', 'x'], 5)).toEqual(['a', 'x']);
  });

  it('builds them from the first usable planned query, else the topic', () => {
    expect(searchSeedFor('ignored', ['nuclear construction costs'])).toBe('nuclear construction costs');
    expect(searchSeedFor('# Nuclear construction costs in France and Korea\nMore text', [])).toContain('nuclear');
  });

  it('keeps the kind of a provider error and its status, never its message', () => {
    expect(providerErrorRecord(Object.assign(new Error('https://x/?key=abc'), { code: 'ETIMEDOUT' }))).toEqual({ error_kind: 'ETIMEDOUT' });
    expect(providerErrorRecord({ name: 'AxiosError', response: { status: 429 } })).toEqual({ error_kind: 'AxiosError', http_status: 429 });
    expect(providerErrorRecord(undefined)).toEqual({ error_kind: 'unknown' });
  });
});

describe('reference lookups and the report writer', () => {
  it('writes every run, a reference lookup included, through the report writer with the citation lock', () => {
    const source = readFileSync(join(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');
    // No rule decides whether the report writer runs: there is no shorter path to choose.
    expect(source).not.toContain('writesThroughReportWriter');
    expect(source).not.toContain('synthesisRuns');
    expect(source).not.toContain('layer1Run');
    expect(source).not.toContain("shouldRunPipelineStage(orchProfile, 'synthesis')");
    expect(source.match(/await generateIterativeReport\(\{/g)).toHaveLength(1);
    // The lock is recorded on the run and nothing takes the record away.
    expect(source).toContain('JSON.stringify({ citationLock: true, ...(doiCheckRecord ? { doiChecks: doiCheckRecord } : {}) })');
    expect(source).not.toContain("- 'citationLock'");
    expect(source).not.toMatch(/citationLock:\s*false/);
    // The recorded synthesis time is kept for every run.
    expect(source).toContain("(s === 'synthesis' || shouldRunPipelineStage(orchProfile, s))");
    // Every discovery pass is told what the request is about.
    expect(source.match(/routingBrief: \{ intent: orchProfile\.intent, layer2: isAdjudicative \}/g)).toHaveLength(3);
    expect(source).not.toContain('configuredCap: config.discovery.maxIngestPerRun');
  });

  it('has no rule left in the profiles for choosing a writer', () => {
    const profiles = readFileSync(join(__dirname, '../services/planning/orchestrationProfiles.ts'), 'utf8');
    expect(profiles).not.toContain('writesThroughReportWriter');
    expect(getOrchestrationProfileForIntent('reference_lookup').intent).toBe('reference_lookup');
  });
});
