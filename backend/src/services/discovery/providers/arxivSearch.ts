import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { SearchProvider } from './searchProvider';
import { BibliographicDetails, SearchQuery, SearchResultCandidate, isCalendarDay } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface ArxivEntry {
  id?: string;
  title?: string;
  summary?: string;
  'arxiv:doi'?: string;
  published?: string;
  author?: Array<{ name?: string }> | { name?: string };
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

/** Strip arxiv.org/abs/ prefix (http or https) and version suffix from Atom id URLs. */
function arxivIdFromAbsUrl(absUrl: string): string {
  return absUrl
    .replace(/^https?:\/\/arxiv\.org\/abs\//i, '')
    .replace(/v\d+$/, '');
}

/** What the feed entry says about who wrote the paper and when it was posted. */
export function arxivBibliographic(entry: ArxivEntry): BibliographicDetails | undefined {
  const list = Array.isArray(entry.author) ? entry.author : entry.author ? [entry.author] : [];
  const authors = list.map((author) => (typeof author?.name === 'string' ? author.name.replace(/\s+/g, ' ').trim() : '')).filter(Boolean);
  const out: BibliographicDetails = { publisher: 'arXiv', kind: 'preprint' };
  if (authors.length > 0) out.authors = authors;
  const day = /^(\d{4}-\d{2}-\d{2})/.exec(typeof entry.published === 'string' ? entry.published.trim() : '')?.[1];
  if (day && isCalendarDay(day)) out.publishedAt = day;
  return out;
}

export class ArxivSearchProvider implements SearchProvider {
  readonly name = 'arxiv';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;

    try {
      const response = await axios.get<string>(
        'https://export.arxiv.org/api/query',
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

          const arxivId = arxivIdFromAbsUrl(absUrl);

          return {
            url,
            title,
            snippet,
            score: Math.max(0, 1 - idx / Math.max(1, entries.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: arxivId || undefined,
            bibliographic: arxivBibliographic(entry),
          };
        });
    } catch (err) {
      logger.warn('[discovery] arXiv search failed:', err);
      query.onFailure?.(err);
      return [];
    }
  }
}
