import axios from 'axios';
import { SearchProvider } from './searchProvider';
import { SearchQuery, SearchResultCandidate, PROVIDER_NOT_CONFIGURED } from '../providerTypes';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { ProviderResponseError, clampCount, jsonObjectOrThrow, safeFailureRecord } from './providerHttp';

/**
 * United States patent applications and grants from the USPTO Open Data
 * Portal, Patent File Wrapper search:
 * `GET https://api.uspto.gov/api/v1/patent/applications/search?q=…&limit=…`
 * with the `X-API-KEY` header (https://data.uspto.gov/apis/getting-started,
 * https://data.uspto.gov/apis/patent-file-wrapper/search). The key is free and
 * comes from a USPTO.gov account on the Open Data Portal; set it as
 * `USPTO_API_KEY`. Without it the provider is not configured and no request is
 * made. It answers 401 without a key.
 *
 * The legacy PatentsView API (api.patentsview.org) is retired and now
 * redirects to an HTML page; it is not called.
 *
 * What it covers: the application record (title, numbers, dates, status). It
 * does not return abstracts or claims, so a result's text is its title and
 * record, and the source is read from its page when it is ingested.
 */
export const USPTO_SEARCH_URL = 'https://api.uspto.gov/api/v1/patent/applications/search';
export const USPTO_MAX_RESULTS = 25;

interface UsptoRecord {
  applicationNumber: string;
  title: string;
  patentNumber: string | null;
  publicationNumber: string | null;
  grantDate: string | null;
  filingDate: string | null;
  status: string | null;
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function parseUsptoResults(data: unknown): UsptoRecord[] {
  const body = jsonObjectOrThrow(data, 'USPTO');
  const bag = body.patentFileWrapperDataBag;
  // A search with no matches may leave the bag out; any other shape is not this contract.
  if (bag === undefined && typeof body.count === 'number' && body.count === 0) return [];
  if (!Array.isArray(bag)) throw new ProviderResponseError('unexpected_shape', 'USPTO');
  const out: UsptoRecord[] = [];
  for (const entry of bag) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const meta = (record.applicationMetaData ?? {}) as Record<string, unknown>;
    const applicationNumber = text(record.applicationNumberText);
    const title = text(meta.inventionTitle);
    if (!applicationNumber || !title) continue;
    out.push({
      applicationNumber,
      title,
      patentNumber: text(meta.patentNumber),
      publicationNumber: text(meta.earliestPublicationNumber),
      grantDate: text(meta.grantDate),
      filingDate: text(meta.filingDate),
      status: text(meta.applicationStatusDescriptionText),
    });
  }
  return out;
}

/** A public page for the record: the granted patent, else its publication. A record with neither has no page and is left out. */
export function usptoRecordUrl(record: UsptoRecord): string | null {
  if (record.patentNumber) return `https://patents.google.com/patent/US${record.patentNumber.replace(/[^0-9A-Za-z]/g, '')}`;
  if (record.publicationNumber) return `https://patents.google.com/patent/${record.publicationNumber.replace(/[^0-9A-Za-z]/g, '')}`;
  return null;
}

export class UsptoSearchProvider implements SearchProvider {
  readonly name = 'uspto';

  async search(query: SearchQuery): Promise<SearchResultCandidate[]> {
    const apiKey = config.discovery.usptoApiKey;
    if (!apiKey) {
      logger.warn('[discovery] USPTO provider selected but USPTO_API_KEY is missing');
      query.onFailure?.(PROVIDER_NOT_CONFIGURED);
      return [];
    }
    const limit = clampCount(query.maxResults ?? config.discovery.maxResults, 1, USPTO_MAX_RESULTS, 10);
    try {
      const response = await axios.get(USPTO_SEARCH_URL, {
        params: { q: query.text.trim(), limit, offset: 0 },
        headers: { Accept: 'application/json', 'X-API-KEY': apiKey },
        timeout: 15000,
        // A retired or moved API redirects to an HTML page; that is a failure, not an empty answer.
        maxRedirects: 0,
      });
      const records = parseUsptoResults(response.data);
      const out: SearchResultCandidate[] = [];
      for (const record of records) {
        const url = usptoRecordUrl(record);
        if (!url) continue;
        const facts = [
          record.patentNumber ? `US patent ${record.patentNumber}` : `US application ${record.applicationNumber}`,
          record.grantDate ? `granted ${record.grantDate}` : record.filingDate ? `filed ${record.filingDate}` : null,
          record.status,
        ].filter(Boolean);
        out.push({
          url,
          title: record.title,
          snippet: facts.join('; '),
          score: 0,
          rank: out.length + 1,
          provider: this.name,
          sourceQuery: query.text,
          contentHash: record.patentNumber ? `US${record.patentNumber}` : `USAPP${record.applicationNumber}`,
        });
        if (out.length >= limit) break;
      }
      return out.map((candidate, idx) => ({ ...candidate, score: Math.max(0, 1 - idx / Math.max(1, out.length)) }));
    } catch (err) {
      logger.warn('[discovery] USPTO patent search failed', safeFailureRecord(err));
      query.onFailure?.(err);
      return [];
    }
  }
}
