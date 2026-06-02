/**
 * Blocks outbound fetches to private/reserved hosts (SSRF mitigation).
 * Used by manual ingest, site crawl, and revision supplemental URL fetch.
 */

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'localhost.localdomain',
  'metadata.google.internal',
]);

/** Hostnames/IPs that must not be fetched from user-supplied URLs. */
const PRIVATE_HOST_REGEX =
  /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|fc00:|fd)/i;

export class UrlFetchPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UrlFetchPolicyError';
  }
}

/** Parse and reject non-public http(s) targets before any outbound request. */
export function assertPublicHttpUrl(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new UrlFetchPolicyError('Invalid URL');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlFetchPolicyError('URL must use http or https');
  }

  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (BLOCKED_HOSTNAMES.has(hostname)) {
    throw new UrlFetchPolicyError('URL hostname is not allowed');
  }

  if (hostname === '::1' || hostname.endsWith('.localhost')) {
    throw new UrlFetchPolicyError('URL hostname is not allowed');
  }

  if (PRIVATE_HOST_REGEX.test(hostname)) {
    throw new UrlFetchPolicyError('URL hostname is not allowed');
  }

  // IPv4 literal
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) {
    const parts = hostname.split('.').map((p) => Number(p));
    if (parts[0] === 127 || parts[0] === 10 || parts[0] === 0) {
      throw new UrlFetchPolicyError('URL hostname is not allowed');
    }
    if (parts[0] === 192 && parts[1] === 168) {
      throw new UrlFetchPolicyError('URL hostname is not allowed');
    }
    if (parts[0] === 169 && parts[1] === 254) {
      throw new UrlFetchPolicyError('URL hostname is not allowed');
    }
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
      throw new UrlFetchPolicyError('URL hostname is not allowed');
    }
  }

  return parsed;
}
