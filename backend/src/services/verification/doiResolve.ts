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

async function checkOne(doi: string, http: DoiHttp, alreadyResolved = false): Promise<DoiCheck> {
  const address = `https://doi.org/${doi.split('/').map(encodeURIComponent).join('/')}`;
  let status: ResolveStatus = alreadyResolved ? 'resolved' : 'unresolved';
  let networkFailure = false;
  // A DOI the resolver answered for moments ago is not asked about again: a
  // second request that timed out would set aside a source just shown to be good.
  if (!alreadyResolved) try {
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
 * A DOI in `knownToResolve` was resolved moments ago (see `findUnstatedDois`)
 * and only its editorial record is read.
 *
 * When two or more were asked and not one lookup got an answer, the fault is
 * ours or the network's, not the sources': every result comes back "unknown",
 * so an outage cannot empty a report of its sources.
 */
export async function checkDois(dois: string[], http: DoiHttp = axiosHttp, knownToResolve: ReadonlySet<string> = new Set()): Promise<Map<string, DoiCheck>> {
  const unique = [...new Set(dois)];
  const results: DoiCheck[] = [];
  const CONCURRENT = 4;
  for (let at = 0; at < unique.length; at += CONCURRENT) {
    results.push(...(await Promise.all(unique.slice(at, at + CONCURRENT).map((doi) => checkOne(doi, http, knownToResolve.has(doi))))));
  }
  const outage = results.length >= 2 && results.every((result) => result.networkFailure);
  if (outage) logger.warn('[doi-resolve] no DOI lookup got an answer; treating the check as unavailable', { asked: results.length });
  return new Map(results.map((result) => [result.doi, outage ? { ...result, status: 'unknown' as const } : result]));
}

/**
 * DOIs for sources that state none (follow-up to part 3).
 *
 * A source found by web search has no provider record, and its address is the
 * publisher's or PubMed's page, not doi.org. Two ways to its DOI:
 *  - PubMed and PubMed Central pages: NCBI's own record of the article names
 *    the DOI. That is a stated DOI, the same as a search provider's record.
 *  - A publisher address that carries the DOI in its path. That is a guess: the
 *    address may add words after the DOI. A guess is used only when doi.org
 *    knows it. A guess that does not resolve is dropped and the source is
 *    treated as having no DOI, so a mis-read address can never set a good
 *    source aside.
 */
const PATH_TAIL = /(?:\/(?:full|abstract|pdf|epdf|html|fulltext|meta|figures|references|tables|metrics))+\/?$|\.(?:pdf|html?)$/i;
/**
 * The path words publishers put directly before an article's own DOI
 * ("/doi/10…", "/doi/full/10…", "/article/10…", "/fulltext/10…"). A DOI
 * anywhere else in a path may be another work's: a news page about a paper, a
 * reference list, a search. Those are not read.
 */
const ARTICLE_PATH = /\/(?:doi(?:\/(?:abs|full|pdf|epdf|pdfdirect|book|10))?|articles?|fulltext|chapter|content|abstract|lookup\/doi)\/(10\.\d{4,9}\/[^\s]+)$/i;

/**
 * DOIs an article address may hold, likeliest first. Read only where the DOI
 * is the address's own article: the DOI follows one of the article path words
 * and runs to the end of the path. Empty for doi.org addresses (`doiOf` reads
 * those) and for anything else.
 */
export function doiGuessesFrom(address: string | null | undefined): string[] {
  if (!address || doiOf(address)) return [];
  let path: string;
  try {
    const parsed = new URL(address.trim());
    if (!/^https?:$/.test(parsed.protocol)) return [];
    path = decodeURIComponent(parsed.pathname);
  } catch {
    return [];
  }
  const match = ARTICLE_PATH.exec(path.replace(/\/+$/, ''));
  if (!match) return [];
  const whole = match[1];
  const trimmed = whole.split('~')[0].replace(PATH_TAIL, '').replace(/[.,;)\]]+$/, '');
  return [...new Set([trimmed, whole].map((doi) => doi.toLowerCase()).filter((doi) => /^10\.\d{4,9}\/\S+$/.test(doi)))];
}

/** The article a PubMed or PubMed Central address is for, or null. */
export function ncbiArticleOf(address: string | null | undefined): { db: 'pubmed' | 'pmc'; id: string } | null {
  if (!address) return null;
  let parsed: URL;
  try {
    parsed = new URL(address.trim());
  } catch {
    return null;
  }
  const host = parsed.hostname.toLowerCase();
  const pubmed = host === 'pubmed.ncbi.nlm.nih.gov' ? /^\/(\d{1,9})\/?$/.exec(parsed.pathname) : null;
  if (pubmed) return { db: 'pubmed', id: pubmed[1] };
  const pmc = host === 'pmc.ncbi.nlm.nih.gov' || host === 'www.ncbi.nlm.nih.gov' ? /\/articles\/PMC(\d{1,9})(?:\/|$)/i.exec(parsed.pathname) : null;
  if (pmc) return { db: 'pmc', id: pmc[1] };
  return null;
}

const NCBI_SUMMARY = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi';
/** Sources asked about in one run. Past this the rest are treated as having no DOI. */
const UNSTATED_LIMIT = 60;

/** NCBI asks every caller to say who it is, and allows three requests a second without a key. */
const NCBI_GAP_MS = 400;
let ncbiTurn: Promise<void> = Promise.resolve();
/** One NCBI request at a time across the whole process, spaced apart. */
function ncbiPaced<T>(work: () => Promise<T>, gapMs = NCBI_GAP_MS): Promise<T> {
  const result = ncbiTurn.then(work);
  ncbiTurn = result.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, gapMs)),
    () => new Promise<void>((resolve) => setTimeout(resolve, gapMs))
  );
  return result;
}

function ncbiIdentity(): string {
  const email = /mailto:([^\s)>]+)/i.exec(config.discovery.crossrefUserAgent)?.[1];
  return `&tool=researchone${email ? `&email=${encodeURIComponent(email)}` : ''}`;
}

async function ncbiDois(db: 'pubmed' | 'pmc', ids: string[], http: DoiHttp, gapMs?: number): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (ids.length === 0) return found;
  try {
    const data = (await ncbiPaced(() => http.json(`${NCBI_SUMMARY}?db=${db}&id=${ids.join(',')}&retmode=json${ncbiIdentity()}`), gapMs)) as { result?: Record<string, unknown> } | null;
    for (const id of ids) {
      const record = data?.result?.[id] as { articleids?: Array<{ idtype?: unknown; value?: unknown }> } | undefined;
      const listed = Array.isArray(record?.articleids) ? record.articleids.find((entry) => String(entry?.idtype ?? '').toLowerCase() === 'doi')?.value : undefined;
      const doi = typeof listed === 'string' ? /^10\.\d{4,9}\/\S+$/.exec(listed.trim())?.[0] : undefined;
      if (doi) found.set(id, doi.toLowerCase());
    }
  } catch (err) {
    // No record read: these sources stay without a DOI, as they were.
    logger.warn('[doi-resolve] no NCBI record read; those sources are treated as stating no DOI', { db, asked: ids.length, err: (err as Error)?.message });
  }
  return found;
}

async function firstKnownGuess(guesses: string[], http: DoiHttp): Promise<string | null> {
  for (const guess of guesses) {
    try {
      const address = `https://doi.org/${guess.split('/').map(encodeURIComponent).join('/')}`;
      let code = await http.status('HEAD', address);
      if (code === 403 || code === 405) code = await http.status('GET', address);
      if (code >= 200 && code < 400) return guess;
    } catch {
      // No answer is not a yes.
    }
  }
  return null;
}

/** What was found for sources that state no DOI. */
export interface UnstatedDois {
  /** The DOI of each address one was found for. Addresses with none are absent. */
  byAddress: Map<string, string>;
  /** DOIs read from an address, which the resolver has therefore already said it knows. `checkDois` does not ask again. */
  knownToResolve: Set<string>;
}

/** The DOI of each address that states none, where one can be found. Never throws. */
export async function findUnstatedDois(
  addresses: Array<string | null | undefined>,
  http: DoiHttp = axiosHttp,
  ncbiGapMs?: number
): Promise<UnstatedDois> {
  const byAddress = new Map<string, string>();
  const knownToResolve = new Set<string>();
  try {
    const unique = [...new Set(addresses.filter((address): address is string => Boolean(address) && !doiOf(address)))].slice(0, UNSTATED_LIMIT);
    const articles = unique.map((address) => ({ address, article: ncbiArticleOf(address) }));
    for (const db of ['pubmed', 'pmc'] as const) {
      const mine = articles.filter((entry) => entry.article?.db === db);
      const dois = await ncbiDois(db, [...new Set(mine.map((entry) => entry.article!.id))], http, ncbiGapMs);
      for (const entry of mine) {
        const doi = dois.get(entry.article!.id);
        if (doi) byAddress.set(entry.address, doi);
      }
    }
    const guessed = unique.map((address) => ({ address, guesses: doiGuessesFrom(address) })).filter((entry) => entry.guesses.length > 0 && !byAddress.has(entry.address));
    const CONCURRENT = 4;
    for (let at = 0; at < guessed.length; at += CONCURRENT) {
      await Promise.all(
        guessed.slice(at, at + CONCURRENT).map(async (entry) => {
          const doi = await firstKnownGuess(entry.guesses, http);
          if (doi) {
            byAddress.set(entry.address, doi);
            knownToResolve.add(doi);
          }
        })
      );
    }
  } catch (err) {
    logger.warn('[doi-resolve] looking for unstated DOIs failed; those sources are treated as having none', { err: (err as Error)?.message });
  }
  return { byAddress, knownToResolve };
}
