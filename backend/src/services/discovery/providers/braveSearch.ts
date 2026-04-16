import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

interface BraveResponse {
  web?: {
    results?: BraveResult[];
  };
}

export class BraveSearchProvider implements SearchProvider {
  readonly name = 'brave';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.providerApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Brave provider selected but SEARCH_PROVIDER_API_KEY is missing');
      return [];
    }

    try {
      const response = await axios.get<BraveResponse>('https://api.search.brave.com/res/v1/web/search', {
        params: {
          q: searchQuery.text,
          count: searchQuery.maxResults ?? config.discovery.maxResults,
        },
        timeout: 15000,
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': apiKey,
        },
      });
      const results = response.data.web?.results ?? [];
      return results
        .filter((r): r is Required<Pick<BraveResult, 'url'>> & BraveResult => Boolean(r.url))
        .map((r, idx) => ({
          url: r.url!,
          title: r.title ?? r.url!,
          snippet: r.description ?? '',
          score: Math.max(0, 1 - idx / Math.max(1, results.length)),
          rank: idx + 1,
          provider: this.name,
          sourceQuery: searchQuery.text,
        }));
    } catch (err) {
      logger.error('[discovery] Brave web search failed:', err);
      return [];
    }
  }
}
