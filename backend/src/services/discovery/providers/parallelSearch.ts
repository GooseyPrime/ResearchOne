import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate, PROVIDER_NOT_CONFIGURED } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { ProviderResponseError, clampCount, fitQuery, jsonObjectOrThrow, safeFailureRecord } from './providerHttp';

/**
 * Parallel Search, `POST {PARALLEL_BASE_URL}/search` (default
 * https://api.parallel.ai/v1/search), as documented at
 * https://docs.parallel.ai/api-reference/search-beta/search :
 *   - auth: `x-api-key` header;
 *   - body: `objective` (natural language), `search_queries` (keyword
 *     queries, at least one), `advanced_settings.max_results` (default 10);
 *   - answer: `results[]` with `url`, `title`, `publish_date`, `excerpts[]`,
 *     ordered by decreasing relevance.
 * Fields outside the contract are not sent: the API refuses unknown fields.
 */
export const PARALLEL_MAX_RESULTS = 20;
/** The documented guidance is 3 to 6 words per keyword query. */
const KEYWORD_QUERY_WORDS = 6;

interface ParallelResult {
  url: string;
  title: string | null;
  excerpts: string[];
  publish_date: string | null;
}

export function parallelSearchBody(query: SearchQuery): Record<string, unknown> {
  const objective = query.text.trim();
  return {
    objective,
    search_queries: [fitQuery(objective, 200, KEYWORD_QUERY_WORDS)],
    advanced_settings: { max_results: clampCount(query.maxResults, 1, PARALLEL_MAX_RESULTS, 10) },
  };
}

export function parseParallelResults(data: unknown): ParallelResult[] {
  const body = jsonObjectOrThrow(data, 'Parallel');
  if (!Array.isArray(body.results)) throw new ProviderResponseError('unexpected_shape', 'Parallel');
  return body.results
    .filter((r): r is Record<string, unknown> => Boolean(r) && typeof r === 'object' && typeof (r as { url?: unknown }).url === 'string')
    .map((r) => ({
      url: r.url as string,
      title: typeof r.title === 'string' ? r.title : null,
      excerpts: Array.isArray(r.excerpts) ? r.excerpts.filter((e): e is string => typeof e === 'string') : [],
      publish_date: typeof r.publish_date === 'string' ? r.publish_date : null,
    }));
}

export class ParallelSearchProvider implements SearchProvider {
  readonly name = 'parallel';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.parallelApiKey;
    if (!apiKey) {
      logger.warn('[discovery] Parallel provider selected but PARALLEL_API_KEY is missing');
      query.onFailure?.(PROVIDER_NOT_CONFIGURED);
      return [];
    }
    const body = parallelSearchBody(query);
    const maxResults = (body.advanced_settings as { max_results: number }).max_results;
    try {
      const response = await axios.post(`${config.discovery.parallelBaseUrl}/search`, body, {
        headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey },
        timeout: 20000,
      });
      const results = parseParallelResults(response.data).slice(0, maxResults);
      return results.map((r, idx) => ({
        url: r.url,
        title: r.title ?? r.url,
        snippet: r.excerpts.join('\n\n'),
        // Parallel returns no score; the order is its relevance order.
        score: Math.max(0, 1 - idx / Math.max(1, results.length)),
        rank: idx + 1,
        provider: this.name,
        sourceQuery: query.text,
        ...(r.publish_date && /^\d{4}-\d{2}-\d{2}$/.test(r.publish_date) ? { bibliographic: { publishedAt: r.publish_date } } : {}),
      }));
    } catch (err) {
      logger.warn('[discovery] Parallel search failed', safeFailureRecord(err));
      query.onFailure?.(err);
      return [];
    }
  }
}
