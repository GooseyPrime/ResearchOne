import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate, PROVIDER_NOT_CONFIGURED } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { ProviderResponseError, clampCount, fitQuery, jsonObjectOrThrow, safeFailureRecord } from './providerHttp';

/**
 * Brave Web Search, `https://api.search.brave.com/res/v1/web/search`, as
 * documented at https://api-dashboard.search.brave.com/api-reference/web/search :
 * `X-Subscription-Token` header, `q` of at most 600 characters and 75 words,
 * `count` 1 to 20, and `web.results[]` with `url`, `title`, `description`.
 */
export const BRAVE_MAX_RESULTS = 20;
export const BRAVE_MAX_QUERY_CHARS = 600;
export const BRAVE_MAX_QUERY_WORDS = 75;

export function braveSearchParams(query: SearchQuery): { q: string; count: number } {
  return {
    q: fitQuery(query.text, BRAVE_MAX_QUERY_CHARS, BRAVE_MAX_QUERY_WORDS),
    count: clampCount(query.maxResults ?? config.discovery.maxResults, 1, BRAVE_MAX_RESULTS, BRAVE_MAX_RESULTS),
  };
}

interface BraveResult {
  url: string;
  title: string | null;
  description: string;
}

export function parseBraveResults(data: unknown): BraveResult[] {
  const body = jsonObjectOrThrow(data, 'Brave');
  const web = body.web as { results?: unknown } | undefined;
  // A query with no web results has no `web` block; that is an empty answer, not a broken one.
  if (web === undefined) return [];
  if (!web || typeof web !== 'object' || (web.results !== undefined && !Array.isArray(web.results))) {
    throw new ProviderResponseError('unexpected_shape', 'Brave');
  }
  return ((web.results as unknown[]) ?? [])
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof (r as { url?: unknown }).url === 'string')
    .map((r) => ({
      url: r.url as string,
      title: typeof r.title === 'string' ? r.title : null,
      description: typeof r.description === 'string' ? r.description : '',
    }));
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.providerApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Brave provider selected but SEARCH_PROVIDER_API_KEY is missing');
      searchQuery.onFailure?.(PROVIDER_NOT_CONFIGURED);
      return [];
    }
    const params = braveSearchParams(searchQuery);
    try {
      const response = await axios.get('https://api.search.brave.com/res/v1/web/search', {
        params,
        timeout: 15000,
        headers: { Accept: 'application/json', 'X-Subscription-Token': apiKey },
      });
      const results = parseBraveResults(response.data).slice(0, params.count);
      return results.map((r, idx) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.description,
        score: Math.max(0, 1 - idx / Math.max(1, results.length)),
        rank: idx + 1,
        provider: this.name,
        sourceQuery: searchQuery.text,
      }));
    } catch (err) {
      logger.error('[discovery] Brave web search failed', safeFailureRecord(err));
      searchQuery.onFailure?.(err);
      return [];
    }
  }
}
