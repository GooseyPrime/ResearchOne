/**
 * Slice 7. The routing table, the extra queries and the reference lookup's writer.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverageHintsFor, routesFor, selectProviders } from '../services/discovery/providerRouting';
import { providerErrorRecord, withExtraQueries } from '../services/discovery/discoveryOrchestrator';
import { anomalyQueryFor, searchSeedFor } from '../services/discovery/deterministicDiscoveryQueries';
import { getOrchestrationProfileForIntent, writesThroughReportWriter } from '../services/planning/orchestrationProfiles';

const WEB = { webProviders: ['tavily'] as const, braveKeyed: false };
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
    const chosen = selectProviders(brief('Compare open-source libraries for vector search'), { webProviders: ['tavily', 'brave', 'generic'], braveKeyed: true });
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
    const keyed = selectProviders(brief('Did the 1977 Wow! signal have a terrestrial origin?', { layer2: true }), { ...WEB, braveKeyed: true });
    expect(keyed.providers).toContain('brave');
    const anomaly = keyed.extraQueries.find((extra) => extra.purpose === 'anomaly');
    expect(anomaly?.text).toBe(anomalyQueryFor('seed terms'));
    expect(anomaly?.providers).toEqual(keyed.providers);
    expect(selectProviders(brief('Same question', { layer2: true }), WEB).providers).not.toContain('brave');
  });

  it('gives later coverage rounds hints that fit the route', () => {
    expect(coverageHintsFor(['scientific'])).not.toContain('monetization');
    expect(coverageHintsFor(['market'])).toContain('monetization');
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
  const lookup = getOrchestrationProfileForIntent('reference_lookup');

  it('writes a lookup through the report writer only with both switches on', () => {
    expect(writesThroughReportWriter(lookup, true, true)).toBe(true);
    expect(writesThroughReportWriter(lookup, true, false)).toBe(false);
    expect(writesThroughReportWriter(lookup, false, true)).toBe(false);
    expect(writesThroughReportWriter(getOrchestrationProfileForIntent('factual_report'), false, false)).toBe(true);
  });

  it('decides the synthesis path with that rule, with routing read from the run', () => {
    const source = readFileSync(join(__dirname, '../services/reasoning/researchOrchestrator.ts'), 'utf8');
    expect(source).toContain("if (writesThroughReportWriter(orchProfile, layer1Run, providerRoutingEnabled())) {");
    expect(source).not.toContain("if (shouldRunPipelineStage(orchProfile, 'synthesis')) {");
    // Every discovery pass is told what the request is about.
    expect(source.match(/routingBrief: \{ intent: orchProfile\.intent, layer2: isAdjudicative \}/g)).toHaveLength(3);
    expect(source).not.toContain('configuredCap: config.discovery.maxIngestPerRun');
  });
});
