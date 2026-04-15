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
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface GenericSearchResponseResult {
  url: string;
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

export class GenericWebSearchProvider implements SearchProvider {
  readonly name = 'generic';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const { providerBaseUrl, providerApiKey } = config.discovery;

    if (!providerBaseUrl) {
      logger.warn('[discovery] SEARCH_PROVIDER_BASE_URL not configured — skipping external search');
      return [];
    }

    const maxResults = searchQuery.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.post<GenericSearchResponse>(
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

      // Support multiple response shapes
      const rawResults: GenericSearchResponseResult[] =
        response.data.results ?? response.data.organic ?? response.data.items ?? [];

      return rawResults.slice(0, maxResults).map((r, idx) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.content ?? r.snippet ?? '',
        score: typeof r.score === 'number' ? r.score : Math.max(0, 1 - idx / rawResults.length),
        rank: idx + 1,
        provider: this.name,
        sourceQuery: searchQuery.text,
      }));
    } catch (err) {
      logger.error('[discovery] Generic web search failed:', err);
      return [];
    }
  }
}
