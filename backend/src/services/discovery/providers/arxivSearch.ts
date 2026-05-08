import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  'arxiv:doi'?: string;
  link?: Array<{ '@_href'?: string; '@_type'?: string }> | { '@_href'?: string; '@_type'?: string };
}

interface ArxivFeed {
  feed?: {
    entry?: ArxivEntry | ArxivEntry[];
    'opensearch:totalResults'?: number;
  };
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  isArray: (name) => name === 'entry' || name === 'link',
});

export class ArxivSearchProvider implements SearchProvider {
  readonly name = 'arxiv';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.get<string>(
        `http://export.arxiv.org/api/query`,
        {
          params: {
            search_query: `all:${query.text}`,
            max_results: maxResults,
            sortBy: 'relevance',
            sortOrder: 'descending',
          },
          headers: {
            Accept: 'application/xml',
          },
          timeout: 15000,
          responseType: 'text',
        },
      );

      const parsed: ArxivFeed = parser.parse(response.data);
      const rawEntries = parsed.feed?.entry;
      if (!rawEntries) return [];

      const entries: ArxivEntry[] = Array.isArray(rawEntries) ? rawEntries : [rawEntries];

      return entries
        .filter((e) => e.id)
        .slice(0, maxResults)
        .map((entry, idx) => {
          const absUrl = typeof entry.id === 'string' ? entry.id.trim() : '';
          const links = Array.isArray(entry.link) ? entry.link : entry.link ? [entry.link] : [];
          const pdfLink = links.find((l) => l['@_type'] === 'application/pdf');
          const url = pdfLink?.['@_href'] ?? absUrl;
          const title = typeof entry.title === 'string'
            ? entry.title.replace(/\s+/g, ' ').trim()
            : absUrl;
          const snippet = typeof entry.summary === 'string'
            ? entry.summary.replace(/\s+/g, ' ').trim().slice(0, 500)
            : '';

          const arxivId = absUrl.replace('http://arxiv.org/abs/', '').replace(/v\d+$/, '');

          return {
            url,
            title,
            snippet,
            score: Math.max(0, 1 - idx / Math.max(1, entries.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: arxivId || undefined,
          };
        });
    } catch (err) {
      logger.warn('[discovery] arXiv search failed:', err);
      return [];
    }
  }
}
