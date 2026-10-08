/**
 * Slice 7. Which search providers a request goes to, chosen from what the
 * request is about.
 *
 * With PROVIDER_ROUTING_ENABLED on this replaces the specialist mapping in the
 * discovery orchestrator: the providers come from the request itself, not from
 * which specialists the plan scheduled. A market question that happens to
 * schedule a data-analysis specialist therefore still never reaches arXiv or
 * PubMed Central. With the switch off nothing here is called.
 *
 * Pure: the caller supplies the configured web providers and whether Brave has
 * a key, so the choice can be tested without the outside world.
 */
import { anomalyQueryFor, officialRecordQueryFor, repositoryQueryFor } from './deterministicDiscoveryQueries';

export const PROVIDER_KEYS = [
  'tavily',
  'brave',
  'generic',
  'parallel',
  'openalex',
  'crossref',
  'arxiv',
  'pmc',
  'uspto',
  'clinicaltrials',
] as const;
export type ProviderKey = (typeof PROVIDER_KEYS)[number];

export type DiscoveryRoute = 'scientific' | 'patent' | 'market' | 'code' | 'default';

export interface RoutingBrief {
  researchQuery: string;
  /** The run's report type, when known. */
  intent?: string | null;
  researchObjective?: string | null;
  /** A challenge (Layer 2) run: adjudicative report types and the PolicyOne method. */
  layer2: boolean;
  /** What extra queries are built from (`searchSeedFor`). */
  seed: string;
}

export interface RoutingEnvironment {
  /** The general web providers the server is configured with, in cascade order. */
  webProviders: readonly ProviderKey[];
  /** Brave has a key on this server. */
  braveKeyed: boolean;
}

export interface ExtraQuery {
  text: string;
  /** The providers this query is sent to. */
  providers: readonly ProviderKey[];
  /** Why it was added, for the run's discovery record. */
  purpose: 'anomaly' | 'official_record' | 'repository';
}

export interface ProviderSelection {
  routes: DiscoveryRoute[];
  /** Every provider the run searches, in the order results are taken. */
  providers: ProviderKey[];
  extraQueries: ExtraQuery[];
}

const SCIENTIFIC_CUES =
  /\b(clinical|trials?|patients?|diseases?|drugs?|therap(?:y|ies|eutic)|medical|medicine|diagnos\w*|treatments?|vaccines?|cancer|symptoms?|doses?|dosage|efficacy|randomi[sz]ed|meta-analys[ie]s|systematic reviews?|peer[- ]reviewed|epidemiolog\w*|genes?|genetic\w*|genom\w*|proteins?|molecul\w*|physics|chemistry|chemical|biolog\w*|neuro\w*|quantum|enzymes?|pharmac\w*|toxic\w*|pathogens?|virus(?:es)?|bacteri\w*|crispr|fda|scientific|journal articles?|research papers?)\b/i;
const PATENT_CUES = /\b(patents?|patented|prior art|uspto|inventions?)\b/i;
const MARKET_CUES =
  /\b(markets?|marketing|demand|competitors?|competition|pricing|revenue|customers?|startups?|niches?|monetiz\w*|monetis\w*|business(?:es)?|saas|tam|sales|buyers?|consumers?|industry)\b/i;
const CODE_CUES = /\b(github|gitlab|repositor(?:y|ies)|repos?|open[- ]source|librar(?:y|ies)|npm|pypi|sdks?|source code|codebase)\b/i;

const ROUTE_PROVIDERS: Record<Exclude<DiscoveryRoute, 'default' | 'code'>, readonly (ProviderKey | 'web')[]> = {
  scientific: ['openalex', 'crossref', 'pmc', 'clinicaltrials', 'arxiv', 'web'],
  patent: ['uspto', 'openalex', 'web'],
  market: ['parallel', 'web'],
};
const DEFAULT_PROVIDERS: readonly (ProviderKey | 'web')[] = ['web', 'openalex', 'crossref'];

/** The routes a request is relevant to, from its report type, objective and own words. */
export function routesFor(brief: Pick<RoutingBrief, 'researchQuery' | 'intent' | 'researchObjective'>): DiscoveryRoute[] {
  const text = brief.researchQuery ?? '';
  const routes: DiscoveryRoute[] = [];
  if (brief.intent === 'literature_review' || SCIENTIFIC_CUES.test(text)) routes.push('scientific');
  if (brief.researchObjective === 'PATENT_GAP_ANALYSIS' || PATENT_CUES.test(text)) routes.push('patent');
  if (brief.intent === 'opportunity_discovery' || MARKET_CUES.test(text)) routes.push('market');
  if (CODE_CUES.test(text)) routes.push('code');
  return routes.length > 0 ? routes : ['default'];
}

/**
 * The providers and extra queries for one request.
 *
 * Every relevant route contributes its providers, so a market question that is
 * also technical reaches the academic indexes through the scientific route, and
 * one that is not never does. A challenge run also searches Brave when it has a
 * key and sends the anomaly query to every provider it searches.
 */
export function selectProviders(brief: RoutingBrief, env: RoutingEnvironment): ProviderSelection {
  const routes = routesFor(brief);
  const providers: ProviderKey[] = [];
  const add = (key: ProviderKey) => {
    if (!providers.includes(key)) providers.push(key);
  };
  const addAll = (keys: readonly (ProviderKey | 'web')[]) => {
    for (const key of keys) {
      if (key === 'web') env.webProviders.forEach(add);
      else add(key);
    }
  };
  const extraQueries: ExtraQuery[] = [];

  for (const route of routes) {
    if (route === 'default') {
      addAll(DEFAULT_PROVIDERS);
      extraQueries.push({ text: officialRecordQueryFor(brief.seed), providers: [...env.webProviders], purpose: 'official_record' });
    } else if (route === 'code') {
      addAll(['web']);
      extraQueries.push({ text: repositoryQueryFor(brief.seed), providers: [...env.webProviders], purpose: 'repository' });
    } else {
      addAll(ROUTE_PROVIDERS[route]);
    }
  }

  if (brief.layer2) {
    if (env.braveKeyed) add('brave');
    extraQueries.push({ text: anomalyQueryFor(brief.seed), providers: [...providers], purpose: 'anomaly' });
  }

  return { routes, providers, extraQueries };
}

const COVERAGE_HINTS: Record<DiscoveryRoute, readonly string[]> = {
  scientific: ['systematic review', 'trial results', 'mechanism', 'replication'],
  patent: ['prior art', 'patent claims', 'assignee'],
  market: ['demand signals', 'competitor reality', 'technical feasibility', 'regulatory constraints', 'monetization', 'acquisition'],
  code: ['repository', 'documentation', 'known issues'],
  default: ['official report', 'statistics', 'history'],
};

/**
 * What later coverage rounds add to a query, by route. Without routing every run
 * got the market hints, so a clinical question searched for "monetization".
 */
export function coverageHintsFor(routes: readonly DiscoveryRoute[]): string[] {
  const hints: string[] = [];
  for (const route of routes) for (const hint of COVERAGE_HINTS[route]) if (!hints.includes(hint)) hints.push(hint);
  return hints;
}
