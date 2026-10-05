import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { BibliographicDetails, SearchQuery, SearchResultCandidate, isoFromParts } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface CrossrefItem {
  DOI?: string;
  title?: string[];
  abstract?: string;
  score?: number;
  URL?: string;
  author?: Array<{ given?: string; family?: string; name?: string }>;
  publisher?: string;
  'container-title'?: string[];
  issued?: { 'date-parts'?: number[][] };
}

/** What the record says about who wrote and published the work. Nothing is invented for a field it leaves out. */
export function crossrefBibliographic(item: CrossrefItem): BibliographicDetails | undefined {
  const authors = (item.author ?? [])
    .map((author) => (author.family ? [author.family, author.given].filter(Boolean).join(', ') : (author.name ?? '')).trim())
    .filter(Boolean);
  const journal = Array.isArray(item['container-title']) ? item['container-title'][0] : undefined;
  const parts = item.issued?.['date-parts']?.[0];
  const out: BibliographicDetails = {};
  if (authors.length > 0) out.authors = authors;
  const publisher = (journal || item.publisher || '').trim();
  if (publisher) out.publisher = publisher;
  const published = isoFromParts(parts);
  if (published) out.publishedAt = published;
  return Object.keys(out).length > 0 ? out : undefined;
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
            bibliographic: crossrefBibliographic(item),
          };
        });
    } catch (err) {
      logger.warn('[discovery] Crossref search failed:', err);
      return [];
    }
  }
}
