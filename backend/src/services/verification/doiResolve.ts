/**
 * DOI resolution and editorial notices (slice 4, part 3).
 *
 * For a source with a DOI: does the DOI resolve, and has the publisher
 * retracted or corrected the work? The answers decide what a locked report may
 * cite (see `applyDoiChecks` in citationLock.ts). Nothing here runs unless
 * DOI_RESOLVE_ENABLED is on, and nothing here throws: a lookup that fails is an
 * answer ("unresolved"), not an error.
 */
import axios from 'axios';
import { logger } from '../../utils/logger';
import { config } from '../../config';

export type ResolveStatus = 'resolved' | 'unresolved' | 'unknown';
export type EditorialKind = 'retracted' | 'corrected';

export interface DoiCheck {
  doi: string;
  status: ResolveStatus;
  /** Set when the publisher's record says the work was retracted or corrected. */
  notice: { kind: EditorialKind; text: string } | null;
  /** True when the lookup never reached an answer (timeout, connection), as opposed to "not found". */
  networkFailure: boolean;
}

/** The two requests a check needs; replaced in tests. Each resolves to an HTTP status, or rejects when no answer came. */
export interface DoiHttp {
  status(method: 'HEAD' | 'GET', url: string): Promise<number>;
  json(url: string): Promise<unknown>;
}

const TIMEOUT_MS = 8000;

const axiosHttp: DoiHttp = {
  async status(method, url) {
    const response = await axios.request({
      method,
      url,
      timeout: TIMEOUT_MS,
      // The resolver's own answer is the whole question: it redirects for a DOI
      // it knows and says "not found" for one it does not. The redirect is never
      // followed, so this server never requests an address a DOI's owner chose.
      maxRedirects: 0,
      // Every status is an answer; only "no response" rejects.
      validateStatus: () => true,
      headers: { 'User-Agent': config.discovery.crossrefUserAgent },
      // Only the status is read.
      maxContentLength: 64 * 1024,
      responseType: 'text',
    });
    return response.status;
  },
  async json(url) {
    const response = await axios.get(url, { timeout: TIMEOUT_MS, headers: { 'User-Agent': config.discovery.crossrefUserAgent } });
    return response.data as unknown;
  },
};

/** The DOI in a source address, or null. "https://doi.org/10.1000/abc" and "doi:10.1000/abc" both give "10.1000/abc". */
export function doiOf(address: string | null | undefined): string | null {
  if (!address) return null;
  const match = /(?:^|doi\.org\/|doi:\s*)(10\.\d{4,9}\/[^\s?#]+)/i.exec(address.trim());
  if (!match) return null;
  let doi = match[1];
  try {
    doi = decodeURIComponent(doi);
  } catch {
    // Not percent-encoded; used as written.
  }
  return doi.replace(/[.,;)\]]+$/, '').toLowerCase();
}

const RETRACTION_TYPES = /^(retraction|withdrawal|removal|partial[_ -]retraction)$/i;
const CORRECTION_TYPES = /^(correction|erratum|corrigendum|addendum)$/i;

/** What a Crossref work record says was published about the work afterwards. A retraction outranks a correction. */
export function editorialNoticeFrom(record: unknown): DoiCheck['notice'] {
  const message = (record as { message?: { 'updated-by'?: unknown } } | null)?.message;
  const updates = Array.isArray(message?.['updated-by']) ? (message?.['updated-by'] as Array<{ type?: unknown; label?: unknown }>) : [];
  const types = updates.map((update) => (typeof update?.type === 'string' ? update.type : ''));
  if (types.some((type) => RETRACTION_TYPES.test(type))) return { kind: 'retracted', text: 'The publisher has retracted this work.' };
  if (types.some((type) => CORRECTION_TYPES.test(type))) return { kind: 'corrected', text: 'The publisher has issued a correction to this work.' };
  return null;
}

async function checkOne(doi: string, http: DoiHttp): Promise<DoiCheck> {
  const address = `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
  let status: ResolveStatus = 'unresolved';
  let networkFailure = false;
  try {
    let code = await http.status('HEAD', address);
    // Should the resolver refuse HEAD, the same address is asked for with GET.
    if (code === 403 || code === 405) code = await http.status('GET', address);
    // "Not found" and "gone" are the resolver saying it does not know the DOI.
    if (code === 404 || code === 410) status = 'unresolved';
    // A redirect, or a page, is the resolver saying it does.
    else if (code >= 200 && code < 400) status = 'resolved';
    // Anything else (rate limited, refused, a fault) is no answer about the DOI, the same as a timeout.
    else throw new Error(`resolver answered ${code}`);
  } catch (err) {
    networkFailure = true;
    logger.warn('[doi-resolve] no answer for a DOI', { doi, err: (err as Error)?.message });
  }
  let notice: DoiCheck['notice'] = null;
  if (status === 'resolved') {
    try {
      notice = editorialNoticeFrom(await http.json(`https://api.crossref.org/works/${encodeURIComponent(doi)}`));
    } catch (err) {
      // No record is not a notice. Many DOIs are not Crossref's (DataCite, for one).
      logger.debug('[doi-resolve] no Crossref record read for a DOI', { doi, err: (err as Error)?.message });
    }
  }
  return { doi, status, notice, networkFailure };
}

/**
 * Check each DOI once, a few at a time. Never throws.
 *
 * When two or more were asked and not one lookup got an answer, the fault is
 * ours or the network's, not the sources': every result comes back "unknown",
 * so an outage cannot empty a report of its sources.
 */
export async function checkDois(dois: string[], http: DoiHttp = axiosHttp): Promise<Map<string, DoiCheck>> {
  const unique = [...new Set(dois)];
  const results: DoiCheck[] = [];
  const CONCURRENT = 4;
  for (let at = 0; at < unique.length; at += CONCURRENT) {
    results.push(...(await Promise.all(unique.slice(at, at + CONCURRENT).map((doi) => checkOne(doi, http)))));
  }
  const outage = results.length >= 2 && results.every((result) => result.networkFailure);
  if (outage) logger.warn('[doi-resolve] no DOI lookup got an answer; treating the check as unavailable', { asked: results.length });
  return new Map(results.map((result) => [result.doi, outage ? { ...result, status: 'unknown' as const } : result]));
}
