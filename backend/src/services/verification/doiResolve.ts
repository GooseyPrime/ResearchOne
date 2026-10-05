/**
 * DOI resolution and retraction checking (slice 4, part 3).
 *
 * For each citation with a DOI: request https://doi.org/{doi} with the existing Crossref user agent,
 * timeout 8 seconds, HEAD first, retry with GET on 403 or 405. 404 or a network failure marks
 * the citation `unresolved`. Retraction or correction is read from Crossref record (and Scite
 * when configured) and stored in `editorial_notice`.
 */

import axios from 'axios';
import { logger } from '../../utils/logger';
import { config, switchEnabled } from '../../config';

export interface DoiResolutionResult {
  doi: string;
  /** 'resolved', 'unresolved', 'retracted', 'corrected', etc. */
  resolveStatus: string;
  /** Details about retraction, correction, or other editorial notices */
  editorialNotice?: string;
}

/**
 * Checks if DOI resolution is enabled via the feature flag.
 * Respects per-run overrides via runWithFlags (same pattern as CITATION_LOCK_ENABLED).
 */
export function doiResolveEnabled(): boolean {
  return switchEnabled('DOI_RESOLVE_ENABLED');
}

/**
 * Resolves DOIs for citations, checking for availability and editorial status.
 * 
 * @param dois Array of DOI strings to resolve
 * @returns Array of resolution results
 */
export async function resolveDois(dois: string[]): Promise<DoiResolutionResult[]> {
  if (!doiResolveEnabled() || dois.length === 0) {
    return dois.map(doi => ({
      doi,
      resolveStatus: 'unknown', // When disabled, we don't resolve
    }));
  }

  const results: DoiResolutionResult[] = [];

  for (const doi of dois) {
    try {
      const result = await resolveSingleDoi(doi);
      results.push(result);
    } catch (error) {
      logger.warn(`[doi-resolve] Failed to resolve DOI ${doi}:`, error);
      results.push({
        doi,
        resolveStatus: 'unresolved',
        editorialNotice: `DOI resolution failed: ${(error as Error).message}`,
      });
    }
  }

  return results;
}

function isAxiosLikeError(error: unknown): error is { response?: { status?: number }; code?: string } {
  return Boolean(
    error &&
      typeof error === 'object' &&
      ((error as { isAxiosError?: boolean }).isAxiosError === true || axios.isAxiosError?.(error))
  );
}

/**
 * Resolves a single DOI with HEAD request first, falling back to GET on 403/405.
 */
async function resolveSingleDoi(doi: string): Promise<DoiResolutionResult> {
  const userAgent = config.discovery.crossrefUserAgent;
  const url = `https://doi.org/${encodeURIComponent(doi.trim())}`;

  // First try HEAD request
  try {
    const headResponse = await axios.head(url, {
      headers: {
        'User-Agent': userAgent,
      },
      timeout: 8000, // 8 seconds timeout
    });

    // Check for redirects that might indicate retraction/correction
    const finalUrl = headResponse.request?.res?.responseUrl || url;
    return analyzeDoiResult(doi, finalUrl, headResponse.status);
  } catch (headError) {
    // If HEAD fails with 403 or 405, try GET
    if (isAxiosLikeError(headError)) {
      const statusCode = headError.response?.status;
      if (statusCode === 403 || statusCode === 405) {
        return await doGetRequest(doi, url, userAgent);
      } else if (statusCode === 404) {
        return {
          doi,
          resolveStatus: 'unresolved',
          editorialNotice: 'DOI not found (404)',
        };
      }
    }

    // For other errors, try GET as fallback
    try {
      return await doGetRequest(doi, url, userAgent);
    } catch (_getError) {
      logger.debug(`[doi-resolve] DOI ${doi} resolution failed with network error`);
      return {
        doi,
        resolveStatus: 'unresolved',
        editorialNotice: 'Network error during DOI resolution',
      };
    }
  }
}

/**
 * Performs a GET request for DOI resolution when HEAD fails.
 */
async function doGetRequest(doi: string, url: string, userAgent: string): Promise<DoiResolutionResult> {
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
      },
      timeout: 8000, // 8 seconds timeout
    });

    const finalUrl = response.request?.res?.responseUrl || url;
    return analyzeDoiResult(doi, finalUrl, response.status);
  } catch (error) {
    if (isAxiosLikeError(error)) {
      if (error.response?.status === 404) {
        return {
          doi,
          resolveStatus: 'unresolved',
          editorialNotice: 'DOI not found (404)',
        };
      }
    }

    // Network error or other issue
    logger.debug(`[doi-resolve] DOI ${doi} GET request failed with error`);
    return {
      doi,
      resolveStatus: 'unresolved',
      editorialNotice: 'Network error during DOI resolution',
    };
  }
}

/**
 * Analyzes the result of DOI resolution to determine status and any editorial notices.
 */
function analyzeDoiResult(doi: string, finalUrl: string, statusCode: number): DoiResolutionResult {
  // Check if the final URL indicates a retraction, correction, or other editorial notice
  if (finalUrl.includes('retraction') || finalUrl.toLowerCase().includes('retrac')) {
    return {
      doi,
      resolveStatus: 'retracted',
      editorialNotice: 'Source has been retracted',
    };
  } else if (finalUrl.includes('correction') || finalUrl.toLowerCase().includes('correct')) {
    return {
      doi,
      resolveStatus: 'corrected',
      editorialNotice: 'Source has been corrected',
    };
  } else if (statusCode >= 200 && statusCode < 300) {
    return {
      doi,
      resolveStatus: 'resolved',
    };
  } else if (statusCode === 404) {
    return {
      doi,
      resolveStatus: 'unresolved',
      editorialNotice: 'DOI not found (404)',
    };
  } else {
    // For other status codes, consider as unresolved
    return {
      doi,
      resolveStatus: 'unresolved',
      editorialNotice: `Unexpected status code: ${statusCode}`,
    };
  }
}

/**
 * Fetches detailed information from Crossref API about the DOI, including retraction status.
 */
export async function fetchCrossrefMetadata(doi: string): Promise<{
  retracted: boolean;
  retractionNotice?: string;
  corrected: boolean;
  correctionNotice?: string;
  withdrawn: boolean;
  withdrawalNotice?: string;
}> {
  if (!doiResolveEnabled()) {
    return {
      retracted: false,
      corrected: false,
      withdrawn: false,
    };
  }

  const userAgent = config.discovery.crossrefUserAgent;
  const url = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
  
  try {
    const response = await axios.get(url, {
      headers: {
        'User-Agent': userAgent,
      },
      timeout: 8000,
    });

    const item = response.data?.message;
    if (!item) {
      return {
        retracted: false,
        corrected: false,
        withdrawn: false,
      };
    }

    // Check Crossref metadata for retraction/correction status
    // Crossref has specific fields for this
    const status = item.status?.toLowerCase() || '';
    const $ref = item.$ref?.toLowerCase() || '';
    const notices = item['relation'] || item['update-to'] || [];

    let retracted = status.includes('retracted') || $ref.includes('retracted');
    let corrected = status.includes('corrected') || $ref.includes('corrected');
    let withdrawn = status.includes('withdrawn') || $ref.includes('withdrawn');
    
    let retractionNotice = '';
    let correctionNotice = '';
    let withdrawalNotice = '';

    // Check for updates that might indicate retraction/correction
    if (Array.isArray(notices)) {
      for (const notice of notices) {
        if (notice.type) {
          const type = notice.type.toLowerCase();
          if (type.includes('retraction')) {
            retracted = true;
            retractionNotice = notice.label || `Retraction notice published`;
          } else if (type.includes('correction') || type.includes('erratum') || type.includes('addendum')) {
            corrected = true;
            correctionNotice = notice.label || `Correction notice published`;
          } else if (type.includes('withdrawal')) {
            withdrawn = true;
            withdrawalNotice = notice.label || `Withdrawal notice published`;
          }
        }
      }
    }

    // Alternative check in Crossref metadata structure
    if (item['is-retracted'] === true) {
      retracted = true;
      retractionNotice = 'Marked as retracted in Crossref metadata';
    }

    return {
      retracted,
      retractionNotice: retracted ? retractionNotice : undefined,
      corrected,
      correctionNotice: corrected ? correctionNotice : undefined,
      withdrawn,
      withdrawalNotice: withdrawn ? withdrawalNotice : undefined,
    };
  } catch (error) {
    logger.warn(`[doi-resolve] Failed to fetch Crossref metadata for ${doi}:`, error);
    return {
      retracted: false,
      corrected: false,
      withdrawn: false,
    };
  }
}