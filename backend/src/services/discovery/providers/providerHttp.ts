/**
 * What every search adapter shares: per-request limits, a check that a 200
 * answer is the JSON the contract promises, and a failure record that names
 * the kind of failure and its HTTP status only. An axios error carries the
 * request headers (the API key) and the body; neither is ever logged or kept.
 */

/** A provider answered 200 with something that is not its documented JSON. */
export class ProviderResponseError extends Error {
  readonly code: 'non_json_response' | 'unexpected_shape';
  constructor(code: 'non_json_response' | 'unexpected_shape', provider: string) {
    super(`${provider} answered with ${code === 'non_json_response' ? 'a page that is not JSON' : 'JSON that does not match its contract'}`);
    this.name = 'ProviderResponseError';
    this.code = code;
  }
}

/** The kind of a failure and its HTTP status. Never its message, headers, URL or body. */
export function safeFailureRecord(reason: unknown): { error_kind: string; http_status?: number } {
  const err = (reason ?? {}) as { code?: unknown; name?: unknown; response?: { status?: unknown } };
  const kind = typeof err.code === 'string' && err.code ? err.code : typeof err.name === 'string' && err.name ? err.name : 'unknown';
  const status = typeof err.response?.status === 'number' ? err.response.status : undefined;
  return status === undefined ? { error_kind: kind } : { error_kind: kind, http_status: status };
}

/** A whole number inside [min, max]; a missing or non-numeric value is the fallback, itself kept inside the range. */
export function clampCount(value: number | undefined, min: number, max: number, fallback: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(max, Math.max(min, n));
}

/** A 200 answer that is a JSON object. An HTML page (a moved or retired API) or a bare string is refused. */
export function jsonObjectOrThrow(data: unknown, provider: string): Record<string, unknown> {
  if (typeof data === 'string') throw new ProviderResponseError('non_json_response', provider);
  if (data === null || typeof data !== 'object' || Array.isArray(data)) throw new ProviderResponseError('unexpected_shape', provider);
  return data as Record<string, unknown>;
}

/** A query cut to a provider's documented size, on a word boundary. */
export function fitQuery(text: string, maxChars: number, maxWords: number): string {
  const words = text.trim().split(/\s+/).filter(Boolean).slice(0, maxWords);
  let out = '';
  for (const word of words) {
    const next = out ? `${out} ${word}` : word;
    if (next.length > maxChars) break;
    out = next;
  }
  return out || text.trim().slice(0, maxChars);
}
