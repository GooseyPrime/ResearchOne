import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface ParallelResult {
  url?: string;
  title?: string;
  snippet?: string;
  score?: number;
}

interface ParallelResponse {
  results?: ParallelResult[];
}

export class ParallelSearchProvider implements SearchProvider {
  readonly name = 'parallel';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.parallelApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Parallel provider selected but PARALLEL_API_KEY is missing');
      return [];
    }

    const maxResults = query.maxResults ?? config.discovery.maxResults;
    const baseUrl = config.discovery.parallelBaseUrl;

    try {
      const response = await axios.post<ParallelResponse>(
        `${baseUrl}/search`,
        {
          query: query.text,
          max_results: maxResults,
          ...(query.tags && query.tags.length > 0 ? { tags: query.tags } : {}),
          ...(query.preferredSourceTypes && query.preferredSourceTypes.length > 0
            ? { source_types: query.preferredSourceTypes }
            : {}),
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          timeout: 20000,
        },
      );

      const results = response.data.results ?? [];
      return results
        .filter((r): r is ParallelResult & { url: string } => Boolean(r.url))
        .slice(0, maxResults)
        .map((r, idx) => ({
          url: r.url,
          title: r.title ?? r.url,
          snippet: r.snippet ?? '',
          score: typeof r.score === 'number' ? r.score : Math.max(0, 1 - idx / Math.max(1, results.length)),
          rank: idx + 1,
          provider: this.name,
          sourceQuery: query.text,
        }));
    } catch (err) {
      logger.warn('[discovery] Parallel search failed:', err);
      return [];
    }
  }
}
