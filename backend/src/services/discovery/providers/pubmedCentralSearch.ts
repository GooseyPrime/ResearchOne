import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { BibliographicDetails, SearchQuery, SearchResultCandidate, isCalendarDay } from '../providerTypes';
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
  /** How ESummary gives a record's identifiers: one entry per kind, the DOI under idtype "doi". */
  articleids?: Array<{ idtype?: string; value?: string }>;
  authors?: Array<{ name?: string }>;
  pubdate?: string;
}

const PMC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * A PubMed name as "Family, G. I.". The summary record writes a person as the
 * family name followed by run-together initials ("Frangoul H", "Smith JA",
 * "van der Berg JA"), which read the other way round would make the initials the
 * family name. A name not of that shape (a group, a name already holding a
 * comma) is kept as written.
 */
export function pmcAuthorName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed.includes(',')) return trimmed;
  const match = /^(.+\S) ([A-Z]{1,3})$/.exec(trimmed);
  if (!match) return trimmed;
  return `${match[1]}, ${match[2].split('').map((letter) => `${letter}.`).join(' ')}`;
}

/** What the summary record says about who wrote and published the article. */
export function pmcBibliographic(summary: ESummaryResult): BibliographicDetails | undefined {
  const authors = (summary.authors ?? []).map((author) => pmcAuthorName(author.name ?? '')).filter(Boolean);
  const publisher = (summary.fulljournalname ?? summary.source ?? '').trim();
  const out: BibliographicDetails = {};
  if (authors.length > 0) out.authors = authors;
  if (publisher) out.publisher = publisher;
  // "2023 Dec 8" gives a day. "2023 Dec" and "2023" do not, and sortdate fills
  // the gap with the first of the month, so neither is read as a day.
  const stated = /^(\d{4}) (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) (\d{1,2})$/.exec((summary.pubdate ?? '').trim());
  if (stated) {
    const month = PMC_MONTHS.indexOf(stated[2]) + 1;
    const day = `${stated[1]}-${String(month).padStart(2, '0')}-${stated[3].padStart(2, '0')}`;
    if (isCalendarDay(day)) out.publishedAt = day;
  }
  // The address is PubMed Central's own page; the DOI is how the work is checked against its publisher.
  const listed = (summary.articleids ?? []).find((entry) => (entry?.idtype ?? '').toLowerCase() === 'doi')?.value;
  const doi = /^10\.\d{4,9}\/\S+$/.exec((listed ?? summary.doi ?? '').trim())?.[0];
  if (doi) out.doi = doi.toLowerCase();
  // PubMed Central holds journal literature; the record names the journal.
  if (publisher) out.kind = 'journal article';
  return Object.keys(out).length > 0 ? out : undefined;
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
            bibliographic: pmcBibliographic(summary),
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);
    } catch (err) {
      logger.warn('[discovery] PubMed Central search failed:', err);
      query.onFailure?.(err);
      return [];
    }
  }
}
