import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface PatentsViewPatent {
  patent_number?: string;
  patent_title?: string;
  patent_abstract?: string;
  patent_date?: string;
}

interface PatentsViewResponse {
  patents?: PatentsViewPatent[];
  count?: number;
  total_patent_count?: number;
}

export class UsptoSearchProvider implements SearchProvider {
  readonly name = 'uspto';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.post<PatentsViewResponse>(
        'https://api.patentsview.org/patents/query',
        {
          q: {
            _text_any: {
              patent_title: query.text,
              patent_abstract: query.text,
            },
          },
          f: ['patent_number', 'patent_title', 'patent_abstract', 'patent_date'],
          o: {
            per_page: maxResults,
            page: 1,
          },
        },
        {
          headers: {
            'Content-Type': 'application/json',
          },
          timeout: 15000,
        },
      );

      const patents = response.data.patents ?? [];
      return patents
        .filter((p) => p.patent_number)
        .slice(0, maxResults)
        .map((patent, idx) => {
          const number = patent.patent_number!;
          const url = `https://patents.google.com/patent/US${number}`;
          return {
            url,
            title: patent.patent_title ?? `US Patent ${number}`,
            snippet: (patent.patent_abstract ?? '').slice(0, 500),
            score: Math.max(0, 1 - idx / Math.max(1, patents.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: `US${number}`,
          };
        });
    } catch (err) {
      logger.warn('[discovery] USPTO PatentsView search failed:', err);
      return [];
    }
  }
}
