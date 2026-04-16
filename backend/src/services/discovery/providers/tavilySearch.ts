import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
  score?: number;
}

interface TavilyResponse {
  results?: TavilyResult[];
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.tavilyApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Tavily provider selected but TAVILY_API_KEY is missing');
      return [];
    }

    const maxResults = searchQuery.maxResults ?? config.discovery.maxResults;
    const endpoint = config.discovery.tavilyBaseUrl;

    try {
      const response = await axios.post<TavilyResponse>(
        endpoint,
        {
          api_key: apiKey,
          query: searchQuery.text,
          max_results: maxResults,
          search_depth: 'advanced',
          include_answer: false,
          include_raw_content: false,
          topic: 'general',
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        }
      );

      const results = response.data.results ?? [];
      return results
        .filter((r): r is Required<Pick<TavilyResult, 'url'>> & TavilyResult => Boolean(r.url))
        .slice(0, maxResults)
        .map((r, idx) => {
          const url = r.url;
          return {
            url,
            title: r.title ?? url,
          snippet: r.content ?? '',
          score: typeof r.score === 'number' ? r.score : Math.max(0, 1 - idx / Math.max(1, results.length)),
          rank: idx + 1,
          provider: this.name,
          sourceQuery: searchQuery.text,
          };
        });
    } catch (err) {
      logger.error('[discovery] Tavily search failed:', err);
      return [];
    }
  }
}
