/**
 * Parse comma-separated CORS origins. Trailing slashes are stripped because
 * browsers send `Origin` without a path segment, and `cors` must match exactly.
 */
export function parseCorsOrigins(raw: string | undefined, fallback: string): string[] {
  return (raw === undefined ? fallback : raw)
    .split(',')
    .map((entry) => entry.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

function isLocalOrIpHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

/** Two-label hostnames only (e.g. researchone.io) — not subdomains or localhost. */
function isApexHost(host: string): boolean {
  if (isLocalOrIpHost(host)) return false;
  return host.split('.').length === 2;
}

function wwwApexPair(origin: string): string[] {
  try {
    const parsed = new URL(origin);
    if (!['http:', 'https:'].includes(parsed.protocol)) return [];
    const host = parsed.hostname.toLowerCase();
    if (host.startsWith('www.')) {
      const apexHost = host.slice(4);
      if (!isApexHost(apexHost)) return [];
      return [`${parsed.protocol}//${apexHost}`];
    }
    if (!isApexHost(host)) return [];
    return [`${parsed.protocol}//www.${host}`];
  } catch {
    return [];
  }
}

/**
 * Expand configured origins with www ↔ apex aliases for the same host so
 * https://researchone.io and https://www.researchone.io both work when only
 * one is listed in CORS_ORIGINS (Work Order P requires both in production env).
 * Aliases apply only to apex domains — not localhost, IPs, or subdomains.
 */
export function expandCorsOriginAliases(origins: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const origin of origins) {
    if (!seen.has(origin)) {
      seen.add(origin);
      out.push(origin);
    }
    for (const alias of wwwApexPair(origin)) {
      if (!seen.has(alias)) {
        seen.add(alias);
        out.push(alias);
      }
    }
  }
  return out;
}

/** Parse CORS_ORIGINS and add www/apex aliases for production frontends. */
export function resolveCorsOrigins(raw: string | undefined, fallback: string): string[] {
  return expandCorsOriginAliases(parseCorsOrigins(raw, fallback));
}
