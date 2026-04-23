import type { AxiosInstance } from 'axios';
import axios from 'axios';

/** When the API returns 429, back off polling until this time (ms since epoch). */
let cooldownUntilMs = 0;

const DEFAULT_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 5 * 60_000;

function parseRetryAfterMs(headers: Record<string, unknown> | undefined): number | null {
  if (!headers) return null;
  const ra = (headers['retry-after'] ?? headers['Retry-After']) as string | number | undefined;
  if (ra == null) return null;
  const s = String(ra).trim();
  const asInt = parseInt(s, 10);
  if (Number.isFinite(asInt) && asInt >= 0) return asInt * 1000;
  const d = Date.parse(s);
  if (Number.isFinite(d)) return Math.max(0, d - Date.now());
  return null;
}

/**
 * Returns true when a recent 429 set a cooldown (used to widen React Query refetch gaps).
 */
export function isInApiRateLimitCooldown(): boolean {
  return Date.now() < cooldownUntilMs;
}

/**
 * React Query `refetchInterval` helper: use a long interval while the API is rate-limiting us.
 */
export function getAdaptiveRefetchIntervalMs(baselineMs: number, cooldownMs = 60_000): number {
  if (!isInApiRateLimitCooldown()) return baselineMs;
  return Math.max(cooldownMs, baselineMs);
}

export function applyApiRateLimitInterceptor(client: AxiosInstance): void {
  client.interceptors.response.use(
    res => res,
    (err: unknown) => {
      if (axios.isAxiosError(err) && err.response?.status === 429) {
        const custom = parseRetryAfterMs(
          err.response.headers as unknown as Record<string, unknown>
        );
        const wait = Math.min(
          Math.max(custom ?? DEFAULT_COOLDOWN_MS, 5_000),
          MAX_COOLDOWN_MS
        );
        cooldownUntilMs = Date.now() + wait;
      }
      return Promise.reject(err);
    }
  );
}
