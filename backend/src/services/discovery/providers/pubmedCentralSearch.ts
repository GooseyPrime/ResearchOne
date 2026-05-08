import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface ESearchResponse {
  esearchresult?: {
    idlist?: string[];
    count?: string;
  };
}

interface ESummaryResult {
  uid?: string;
  title?: string;
  sortfirstauthor?: string;
  source?: string;
  fulljournalname?: string;
  pmcid?: string;
  doi?: string;
}

interface ESummaryResponse {
  result?: Record<string, ESummaryResult | string[]>;
}

export class PubmedCentralSearchProvider implements SearchProvider {
  readonly name = 'pmc';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;

    try {
      const searchResponse = await axios.get<ESearchResponse>(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi',
        {
          params: {
            db: 'pmc',
            term: query.text,
            retmax: maxResults,
            retmode: 'json',
            sort: 'relevance',
          },
          timeout: 15000,
        },
      );

      const ids = searchResponse.data.esearchresult?.idlist ?? [];
      if (ids.length === 0) return [];

      const summaryResponse = await axios.get<ESummaryResponse>(
        'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi',
        {
          params: {
            db: 'pmc',
            id: ids.join(','),
            retmode: 'json',
          },
          timeout: 15000,
        },
      );

      const summaryResult = summaryResponse.data.result ?? {};

      return ids
        .map((id, idx) => {
          const summary = summaryResult[id] as ESummaryResult | undefined;
          if (!summary || typeof summary !== 'object') return null;

          const pmcId = summary.pmcid ?? `PMC${id}`;
          const url = `https://www.ncbi.nlm.nih.gov/pmc/articles/${pmcId}/`;
          const title = summary.title ?? `PMC Article ${id}`;
          const author = summary.sortfirstauthor ?? '';
          const journal = summary.fulljournalname ?? summary.source ?? '';
          const snippet = [author, journal].filter(Boolean).join(' — ');

          return {
            url,
            title,
            snippet,
            score: Math.max(0, 1 - idx / Math.max(1, ids.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: summary.doi || undefined,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    } catch (err) {
      logger.warn('[discovery] PubMed Central search failed:', err);
      return [];
    }
  }
}
