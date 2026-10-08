import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { BibliographicDetails, SearchQuery, SearchResultCandidate, isCalendarDay } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';

interface OpenAlexWork {
  id?: string;
  doi?: string;
  title?: string;
  display_name?: string;
  abstract_inverted_index?: Record<string, number[]>;
  cited_by_count?: number;
  relevance_score?: number;
  authorships?: Array<{ author?: { display_name?: string } }>;
  primary_location?: { source?: { display_name?: string; type?: string } | null } | null;
  publication_date?: string;
  type?: string;
}

/** OpenAlex's own name for what a work is, in words. An "article" is a journal article only when its venue is a journal. */
const OPENALEX_KINDS: Readonly<Record<string, string>> = {
  preprint: 'preprint',
  book: 'book',
  'book-chapter': 'book chapter',
  dataset: 'dataset',
  dissertation: 'dissertation',
  report: 'report',
  review: 'review article',
  standard: 'standard',
};

/** What the record says about who wrote and published the work. */
export function openAlexBibliographic(work: OpenAlexWork): BibliographicDetails | undefined {
  const authors = (work.authorships ?? []).map((entry) => (entry.author?.display_name ?? '').trim()).filter(Boolean);
  const publisher = (work.primary_location?.source?.display_name ?? '').trim();
  const out: BibliographicDetails = {};
  if (authors.length > 0) out.authors = authors;
  if (publisher) out.publisher = publisher;
  if (isCalendarDay(work.publication_date ?? '')) out.publishedAt = work.publication_date;
  const type = (work.type ?? '').toLowerCase();
  const venue = (work.primary_location?.source?.type ?? '').toLowerCase();
  const kind = type === 'article' ? (venue === 'journal' ? 'journal article' : venue === 'conference' ? 'conference paper' : undefined) : OPENALEX_KINDS[type];
  if (kind) out.kind = kind;
  return Object.keys(out).length > 0 ? out : undefined;
}

interface OpenAlexResponse {
  results?: OpenAlexWork[];
}

function reconstructAbstract(invertedIndex: Record<string, number[]> | undefined): string {
  if (!invertedIndex) return '';
  const entries: Array<[string, number]> = [];
  for (const [word, positions] of Object.entries(invertedIndex)) {
    for (const pos of positions) {
      entries.push([word, pos]);
    }
  }
  entries.sort((a, b) => a[1] - b[1]);
  return entries.map(([word]) => word).join(' ');
}

function extractDoiPath(doi: string | undefined): string | undefined {
  if (!doi) return undefined;
  const match = doi.match(/10\.\d{4,}\/\S+/);
  return match ? match[0] : undefined;
}

export class OpenAlexSearchProvider implements SearchProvider {
  readonly name = 'openalex';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const maxResults = query.maxResults ?? config.discovery.maxResults;
    const userAgent = config.discovery.openAlexUserAgent;

    try {
      const response = await axios.get<OpenAlexResponse>(
        'https://api.openalex.org/works',
        {
          params: {
            search: query.text,
            per_page: maxResults,
          },
          headers: {
            'User-Agent': userAgent,
          },
          timeout: 15000,
        },
      );

      const results = response.data.results ?? [];
      return results
        .filter((w) => w.id || w.doi)
        .slice(0, maxResults)
        .map((w, idx) => {
          const doiPath = extractDoiPath(w.doi);
          const url = doiPath ? `https://doi.org/${doiPath}` : w.id ?? '';
          return {
            url,
            title: w.display_name ?? w.title ?? url,
            snippet: reconstructAbstract(w.abstract_inverted_index).slice(0, 500),
            score: typeof w.relevance_score === 'number'
              ? Math.min(1, w.relevance_score / 100)
              : Math.max(0, 1 - idx / Math.max(1, results.length)),
            rank: idx + 1,
            provider: this.name,
            sourceQuery: query.text,
            contentHash: doiPath,
            bibliographic: openAlexBibliographic(w),
          };
        });
    } catch (err) {
      logger.warn('[discovery] OpenAlex search failed:', err);
      query.onFailure?.(err);
      return [];
    }
  }
}
