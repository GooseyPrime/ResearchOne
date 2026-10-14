import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate, PROVIDER_NOT_CONFIGURED } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { ProviderResponseError, clampCount, jsonObjectOrThrow, safeFailureRecord } from './providerHttp';

/**
 * Tavily Search, `POST https://api.tavily.com/search`, as documented at
 * https://docs.tavily.com/documentation/api-reference/endpoint/search :
 * `Authorization: Bearer <key>`, `max_results` 0 to 20 (default 10), and
 * `results[]` with `url`, `title`, `content`, `score`. The per-request count is
 * this provider's limit, never the run's overall source budget.
 */
export const TAVILY_MAX_RESULTS = 20;

export function tavilySearchBody(query: SearchQuery): Record<string, unknown> {
  return {
    query: query.text,
    max_results: clampCount(query.maxResults ?? config.discovery.maxResults, 1, TAVILY_MAX_RESULTS, 10),
    search_depth: 'advanced',
    include_answer: false,
    include_raw_content: false,
    topic: 'general',
  };
}

interface TavilyResult {
  url: string;
  title: string | null;
  content: string;
  score: number | null;
}

export function parseTavilyResults(data: unknown): TavilyResult[] {
  const body = jsonObjectOrThrow(data, 'Tavily');
  if (!Array.isArray(body.results)) throw new ProviderResponseError('unexpected_shape', 'Tavily');
  return body.results
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof (r as { url?: unknown }).url === 'string')
    .map((r) => ({
      url: r.url as string,
      title: typeof r.title === 'string' ? r.title : null,
      content: typeof r.content === 'string' ? r.content : '',
      score: typeof r.score === 'number' ? r.score : null,
    }));
}

export class TavilySearchProvider implements SearchProvider {
  readonly name = 'tavily';

  async search(searchQuery: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.tavilyApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Tavily provider selected but TAVILY_API_KEY is missing');
      searchQuery.onFailure?.(PROVIDER_NOT_CONFIGURED);
      return [];
    }
    const body = tavilySearchBody(searchQuery);
    try {
      const response = await axios.post(config.discovery.tavilyBaseUrl, body, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
        timeout: 15000,
      });
      const results = parseTavilyResults(response.data).slice(0, body.max_results as number);
      return results.map((r, idx) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.content,
        score: r.score ?? Math.max(0, 1 - idx / Math.max(1, results.length)),
        rank: idx + 1,
        provider: this.name,
        sourceQuery: searchQuery.text,
      }));
    } catch (err) {
      logger.error('[discovery] Tavily search failed', safeFailureRecord(err));
      searchQuery.onFailure?.(err);
      return [];
    }
  }
}
