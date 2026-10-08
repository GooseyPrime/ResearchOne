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
import {
  PROVIDER_KEYS,
  PROVIDER_REGISTRY,
  WEB_RANK,
  type DiscoveryRoute,
  type ProviderKey,
} from './providerRegistry';

export { PROVIDER_KEYS, type DiscoveryRoute, type ProviderKey };

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
  /** The general web services the server is set to use (`SEARCH_PROVIDER`), in cascade order. */
  webProviders: readonly ProviderKey[];
  /** Whether a service has what it needs configured. Defaults to the registry's own check. */
  isConfigured?: (key: ProviderKey) => boolean;
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
  /** Providers the routes wanted that have no key or address set; they sit out. */
  notConfigured: ProviderKey[];
  extraQueries: ExtraQuery[];
}

const SCIENTIFIC_CUES =
  /\b(clinical|trials?|patients?|diseases?|drugs?|therap(?:y|ies|eutic)|medical|medicine|diagnos\w*|treatments?|vaccines?|cancer|symptoms?|doses?|dosage|efficacy|randomi[sz]ed|meta-analys[ie]s|systematic reviews?|peer[- ]reviewed|epidemiolog\w*|genes?|genetic\w*|genom\w*|proteins?|molecul\w*|physics|chemistry|chemical|biolog\w*|neuro\w*|quantum|enzymes?|pharmac\w*|toxic\w*|pathogens?|virus(?:es)?|bacteri\w*|crispr|fda|scientific|journal articles?|research papers?)\b/i;
const PATENT_CUES = /\b(patents?|patented|prior art|uspto|inventions?)\b/i;
const MARKET_CUES =
  /\b(markets?|marketing|demand|competitors?|competition|pricing|revenue|customers?|startups?|niches?|monetiz\w*|monetis\w*|business(?:es)?|saas|tam|sales|buyers?|consumers?|industry)\b/i;
const CODE_CUES = /\b(github|gitlab|repositor(?:y|ies)|repos?|open[- ]source|librar(?:y|ies)|npm|pypi|sdks?|source code|codebase)\b/i;

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
  const configured = env.isConfigured ?? ((key: ProviderKey) => PROVIDER_REGISTRY[key].isConfigured());
  const routes = routesFor(brief);
  const providers: ProviderKey[] = [];
  const notConfigured: ProviderKey[] = [];
  const add = (key: ProviderKey) => {
    if (providers.includes(key) || notConfigured.includes(key)) return;
    if (configured(key)) providers.push(key);
    else notConfigured.push(key);
  };
  const web = () => env.webProviders.filter((key) => configured(key));
  const extraQueries: ExtraQuery[] = [];

  for (const route of routes) {
    // The registry's services for this route by rank, with the web services at the route's web rank.
    const ranked: Array<{ rank: number; keys: readonly ProviderKey[] }> = PROVIDER_KEYS.flatMap((key) => {
      const rank = (PROVIDER_REGISTRY[key].routes as Partial<Record<DiscoveryRoute, number>>)[route];
      return rank === undefined ? [] : [{ rank, keys: [key] }];
    });
    ranked.push({ rank: WEB_RANK[route], keys: env.webProviders });
    ranked.sort((x, y) => x.rank - y.rank);
    for (const { keys } of ranked) keys.forEach(add);

    if (route === 'default') {
      extraQueries.push({ text: officialRecordQueryFor(brief.seed), providers: web(), purpose: 'official_record' });
    } else if (route === 'code') {
      extraQueries.push({ text: repositoryQueryFor(brief.seed), providers: web(), purpose: 'repository' });
    }
  }

  if (brief.layer2) {
    for (const key of PROVIDER_KEYS) {
      if ((PROVIDER_REGISTRY[key] as { challengeRuns?: boolean }).challengeRuns && configured(key)) add(key);
    }
    extraQueries.push({ text: anomalyQueryFor(brief.seed), providers: [...providers], purpose: 'anomaly' });
  }

  return { routes, providers, notConfigured, extraQueries };
}

/** What each kind of source covers, from the registry, for the gap-filling planner. */
export function sourceDescriptionsFor(keys: readonly ProviderKey[]): string {
  return keys.map((key) => `${PROVIDER_REGISTRY[key].title}: ${PROVIDER_REGISTRY[key].covers}`).join('\n');
}
