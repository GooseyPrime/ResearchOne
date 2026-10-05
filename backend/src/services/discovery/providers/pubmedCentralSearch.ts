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
  authors?: Array<{ name?: string }>;
  pubdate?: string;
}

const PMC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** What the summary record says about who wrote and published the article. */
export function pmcBibliographic(summary: ESummaryResult): BibliographicDetails | undefined {
  const authors = (summary.authors ?? []).map((author) => (author.name ?? '').trim()).filter(Boolean);
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
      return [];
    }
  }
}
