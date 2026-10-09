/**
 * Every search service discovery can use, in one place.
 *
 * Adding a service is one entry here plus its adapter in `providers/`. The
 * entry says what the service covers, which kinds of request it serves and in
 * what order, and what it needs configured. Routing (`providerRouting.ts`),
 * the gap-filling planner and the provider guide (`docs/SEARCH_PROVIDERS.md`)
 * all read it, so nothing else has to change. A test checks that every entry
 * is described in the guide.
 *
 * A service whose key is not set yet sits out of routed runs and is listed in
 * the run's routing record as not configured; setting the key brings it in.
 */
import { config } from '../../config';
import type { SearchProvider } from './providers/searchProvider';
import { TavilySearchProvider } from './providers/tavilySearch';
import { BraveSearchProvider } from './providers/braveSearch';
import { GenericWebSearchProvider } from './providers/genericWebSearch';
import { ParallelSearchProvider } from './providers/parallelSearch';
import { OpenAlexSearchProvider } from './providers/openAlexSearch';
import { CrossrefSearchProvider } from './providers/crossrefSearch';
import { ArxivSearchProvider } from './providers/arxivSearch';
import { PubmedCentralSearchProvider } from './providers/pubmedCentralSearch';
import { UsptoSearchProvider } from './providers/usptoSearch';
import { ClinicalTrialsSearchProvider } from './providers/clinicalTrialsSearch';

/** The kinds of request routing recognises. See `routesFor` in `providerRouting.ts`. */
export type DiscoveryRoute = 'scientific' | 'patent' | 'market' | 'code' | 'default';

export interface ProviderEntry {
  /** Display name, as the provider guide and the run record use it. */
  title: string;
  /** What the service searches, in a sentence. The gap-filling planner reads this. */
  covers: string;
  /**
   * The routes that use this service and its place in each: lower runs first and
   * wins ties when two services return the same address. The configured web
   * services sit at `WEB_RANK` for their route.
   */
  routes: Partial<Record<DiscoveryRoute, number>>;
  /** One of the general web services the server can be set to (`SEARCH_PROVIDER`). */
  web?: boolean;
  /** Added to every challenge run when configured, whatever the route. */
  challengeRuns?: boolean;
  /**
   * The service holds only scholarly or patent records: research papers,
   * clinical studies, patents. It is searched only for a request whose own
   * routes include one this entry lists, whether or not PROVIDER_ROUTING_ENABLED
   * is on. A civic, political or business question never reaches it.
   */
  scholarlyOnly?: boolean;
  /** Environment settings the service needs; empty for an open service. Names only. */
  needs: readonly string[];
  isConfigured: () => boolean;
  build: () => SearchProvider;
}

/** Where the configured general web services sit in each route. */
export const WEB_RANK: Record<DiscoveryRoute, number> = {
  scientific: 100,
  patent: 100,
  market: 100,
  code: 100,
  default: 10,
};

const always = () => true;

export const PROVIDER_REGISTRY = {
  tavily: {
    title: 'Tavily',
    covers: 'general web search tuned for research, returning page text with each result',
    routes: {},
    web: true,
    needs: ['TAVILY_API_KEY'],
    isConfigured: () => Boolean(config.discovery.tavilyApiKey),
    build: () => new TavilySearchProvider(),
  },
  brave: {
    title: 'Brave Search',
    covers: 'an independent general web index, useful for pages other engines rank low',
    routes: {},
    web: true,
    challengeRuns: true,
    needs: ['SEARCH_PROVIDER_API_KEY'],
    // The same setting is the generic endpoint's optional key, so it is a Brave key
    // only when the server is set to use Brave. Otherwise a generic key would be sent to Brave.
    isConfigured: () => Boolean(config.discovery.providerApiKey) && ['brave', 'cascade'].includes(config.discovery.provider),
    build: () => new BraveSearchProvider(),
  },
  generic: {
    title: 'Generic web search endpoint',
    covers: 'any JSON web search service at a configured address (SearXNG, Serper or similar)',
    routes: {},
    web: true,
    needs: ['SEARCH_PROVIDER_BASE_URL'],
    isConfigured: () => Boolean(config.discovery.providerBaseUrl),
    build: () => new GenericWebSearchProvider(),
  },
  parallel: {
    title: 'Parallel',
    covers: 'business and market information: companies, products, pricing and demand',
    routes: { market: 10 },
    needs: ['PARALLEL_API_KEY'],
    isConfigured: () => Boolean(config.discovery.parallelApiKey),
    build: () => new ParallelSearchProvider(),
  },
  openalex: {
    title: 'OpenAlex',
    covers: 'a catalogue of scholarly works in every field, with authors, venues and DOIs',
    routes: { scientific: 10, patent: 20, default: 20 },
    needs: [],
    isConfigured: always,
    build: () => new OpenAlexSearchProvider(),
  },
  crossref: {
    title: 'Crossref',
    covers: 'the registry of DOIs for journal articles, books and reports, with publisher records',
    routes: { scientific: 20, default: 30 },
    needs: [],
    isConfigured: always,
    build: () => new CrossrefSearchProvider(),
  },
  pmc: {
    title: 'PubMed Central',
    covers: 'full-text biomedical and life-science articles',
    routes: { scientific: 30 },
    scholarlyOnly: true,
    needs: [],
    isConfigured: always,
    build: () => new PubmedCentralSearchProvider(),
  },
  clinicaltrials: {
    title: 'ClinicalTrials.gov',
    covers: 'registered clinical studies, their design, status and posted results',
    routes: { scientific: 40 },
    scholarlyOnly: true,
    needs: [],
    isConfigured: always,
    build: () => new ClinicalTrialsSearchProvider(),
  },
  arxiv: {
    title: 'arXiv',
    covers: 'preprints in physics, mathematics, computer science, quantitative biology and related fields',
    routes: { scientific: 50 },
    scholarlyOnly: true,
    needs: [],
    isConfigured: always,
    build: () => new ArxivSearchProvider(),
  },
  uspto: {
    title: 'USPTO PatentsView',
    covers: 'granted United States patents, their claims, inventors and assignees',
    routes: { patent: 10 },
    scholarlyOnly: true,
    needs: [],
    isConfigured: always,
    build: () => new UsptoSearchProvider(),
  },
} as const satisfies Record<string, ProviderEntry>;

export type ProviderKey = keyof typeof PROVIDER_REGISTRY;
export const PROVIDER_KEYS = Object.keys(PROVIDER_REGISTRY) as ProviderKey[];

export function providerEntry(key: ProviderKey): ProviderEntry {
  return PROVIDER_REGISTRY[key];
}
