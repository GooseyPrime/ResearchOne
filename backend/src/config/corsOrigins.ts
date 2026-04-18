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
