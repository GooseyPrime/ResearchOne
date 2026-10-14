/**
 * Generic web search provider.
 * Uses SEARCH_PROVIDER_BASE_URL and SEARCH_PROVIDER_API_KEY env vars.
 * Implements a JSON search API convention compatible with SearXNG, Serper, or custom endpoints.
 *
 * Expected response shape (subset used):
 * {
 *   results: [
 *     { url, title, content?, snippet?, score? },
 *     ...
 *   ]
 * }
 *
 * If SEARCH_PROVIDER_BASE_URL is not configured, returns an empty result set and logs a warning.
 * This allows the rest of the discovery pipeline to function gracefully in environments
 * where external search is not yet configured.
 */

import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate, PROVIDER_NOT_CONFIGURED } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { ProviderResponseError, jsonObjectOrThrow, safeFailureRecord } from './providerHttp';

interface GenericSearchResponseResult {
  url?: string;
  /** Serper and Google Custom Search name the address `link`. */
  link?: string;
  title?: string;
  content?: string;
  snippet?: string;
  score?: number;
}

interface GenericSearchResponse {
  results?: GenericSearchResponseResult[];
  organic?: GenericSearchResponseResult[]; // Serper-style
  items?: GenericSearchResponseResult[]; // Google Custom Search style
}

/**
 * The results of any of the three shapes, each with an address. A result
 * without `url` or `link` is left out: it cannot be fetched or cited. A 200
 * answer that is not JSON, or has none of the three lists, is a failure.
 */
export function parseGenericResults(data: unknown): Array<{ url: string; title: string; snippet: string; score: number | null }> {
  const body = jsonObjectOrThrow(data, 'The search endpoint') as GenericSearchResponse;
  const raw = body.results ?? body.organic ?? body.items;
  if (!Array.isArray(raw)) throw new ProviderResponseError('unexpected_shape', 'The search endpoint');
  return raw.flatMap((r) => {
    const url = typeof r?.url === 'string' && r.url ? r.url : typeof r?.link === 'string' && r.link ? r.link : null;
    if (!url) return [];
    return [{ url, title: r.title ?? url, snippet: r.content ?? r.snippet ?? '', score: typeof r.score === 'number' ? r.score : null }];
  });
}

export class GenericWebSearchProvider implements SearchProvider {
  readonly name = 'generic';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const { providerBaseUrl, providerApiKey } = config.discovery;

    if (!providerBaseUrl) {
      logger.warn('[discovery] SEARCH_PROVIDER_BASE_URL not configured — skipping external search');
      searchQuery.onFailure?.(PROVIDER_NOT_CONFIGURED);
      return [];
    }

    const maxResults = searchQuery.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.post<unknown>(
        providerBaseUrl,
        {
          q: searchQuery.text,
          num: maxResults,
          format: 'json',
        },
        {
          headers: {
            'Content-Type': 'application/json',
            ...(providerApiKey ? { 'Authorization': `Bearer ${providerApiKey}`, 'X-API-Key': providerApiKey } : {}),
          },
          timeout: 15000,
        }
      );

      return parseGenericResults(response.data)
        .slice(0, maxResults)
        .map((r, idx, all) => ({
          url: r.url,
          title: r.title,
          snippet: r.snippet,
          score: r.score ?? Math.max(0, 1 - idx / Math.max(1, all.length)),
          rank: idx + 1,
          provider: this.name,
          sourceQuery: searchQuery.text,
        }));
    } catch (err) {
      logger.error('[discovery] Generic web search failed', safeFailureRecord(err));
      searchQuery.onFailure?.(err);
      return [];
    }
  }
}
