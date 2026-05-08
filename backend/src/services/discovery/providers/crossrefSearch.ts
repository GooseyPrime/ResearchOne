import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  abstract?: string;
  score?: number;
  URL?: string;
}

interface CrossrefResponse {
  message?: {
    items?: CrossrefItem[];
  };
}

export class CrossrefSearchProvider implements SearchProvider {
  readonly name = 'crossref';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;
    const userAgent = config.discovery.crossrefUserAgent;

    try {
      const response = await axios.get<CrossrefResponse>(
        'https://api.crossref.org/works',
        {
          params: {
            query: query.text,
            rows: maxResults,
          },
          headers: {
            'User-Agent': userAgent,
          },
          timeout: 15000,
        },
      );

      const items = response.data.message?.items ?? [];
      return items
        .filter((item) => item.DOI || item.URL)
        .slice(0, maxResults)
        .map((item, idx) => {
          const doi = item.DOI;
          const url = doi ? `https://doi.org/${doi}` : item.URL ?? '';
          const title = Array.isArray(item.title) && item.title.length > 0
            ? item.title[0]
            : url;
          return {
            url,
            title,
            snippet: (item.abstract ?? '').replace(/<[^>]+>/g, '').slice(0, 500),
            score: typeof item.score === 'number'
              ? Math.min(1, item.score / 200)
              : Math.max(0, 1 - idx / Math.max(1, items.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: doi,
          };
        });
    } catch (err) {
      logger.warn('[discovery] Crossref search failed:', err);
      return [];
    }
  }
}
