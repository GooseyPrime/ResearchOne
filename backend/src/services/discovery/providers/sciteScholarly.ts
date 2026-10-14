/**
 * Scite paper records (https://api.scite.ai/docs, spec at
 * https://api.scite.ai/openapi.json): `GET https://api.scite.ai/papers/{doi}`
 * with `Authorization: Bearer <SCITE_API_KEY>`. The record carries
 * `retracted`, `editorialNotices[]` and a citation `tally` (`supporting`,
 * `contradicting`, `mentioning`, `total`).
 *
 * Optional enrichment. Scite issues API keys through its own accounts
 * (partner/API plans); without SCITE_API_KEY nothing is asked. What Scite does
 * not tell us stays unknown: a missing key, a refused or failed request, or a
 * DOI Scite does not hold is never reported as "not retracted" or as zero
 * citations. Only a record Scite returned is cached.
 *
 * Used by the DOI check (`verification/doiResolve.ts`) as a second source for
 * retractions and corrections, after the publisher's Crossref record.
 */
import axios from 'axios';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { getRedis } from '../../../queue/redis';
import { safeFailureRecord } from './providerHttp';

const CACHE_TTL_SECONDS = 86400;

export interface SciteTally {
  supporting: number;
  contradicting: number;
  mentioning: number;
  total: number;
}

export type SciteRecord =
  | {
      known: true;
      doi: string;
      /** Scite's own flag; null when its record does not say. */
      retracted: boolean | null;
      notices: Array<{ status: string; date: string | null }>;
      tally: SciteTally | null;
    }
  | { known: false; doi: string; reason: 'not_configured' | 'not_found' | 'refused' | 'unavailable' | 'unexpected_shape' };

export function sciteConfigured(): boolean {
  return Boolean(config.discovery.sciteApiKey?.trim());
}

/** The API root. An older setting ending in `/v1` named paths Scite never had; the root is used instead. */
export function sciteBaseUrl(): string {
  return config.discovery.sciteBaseUrl.replace(/\/+$/, '').replace(/\/v1$/, '');
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

export function parseSciteRecord(doi: string, data: unknown): SciteRecord {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { known: false, doi, reason: 'unexpected_shape' };
  const body = data as Record<string, unknown>;
  const rawTally = body.tally as Record<string, unknown> | null | undefined;
  const parts = rawTally ? [count(rawTally.supporting), count(rawTally.contradicting), count(rawTally.mentioning), count(rawTally.total)] : [];
  const tally = parts.length === 4 && parts.every((n) => n !== null) ? { supporting: parts[0]!, contradicting: parts[1]!, mentioning: parts[2]!, total: parts[3]! } : null;
  const notices = Array.isArray(body.editorialNotices)
    ? body.editorialNotices.flatMap((n) => {
        const notice = n as { status?: unknown; date?: unknown };
        return typeof notice?.status === 'string' && notice.status.trim() ? [{ status: notice.status.trim(), date: typeof notice.date === 'string' ? notice.date : null }] : [];
      })
    : [];
  return { known: true, doi, retracted: typeof body.retracted === 'boolean' ? body.retracted : null, notices, tally };
}

type Getter = (url: string, options: Record<string, unknown>) => Promise<{ status?: number; data?: unknown }>;

export async function sciteRecordFor(doi: string, get: Getter = axios.get as unknown as Getter): Promise<SciteRecord> {
  if (!sciteConfigured()) return { known: false, doi, reason: 'not_configured' };
  const cacheKey = `scite:paper:${doi.toLowerCase()}`;
  try {
    const cached = await getRedis().get(cacheKey);
    if (cached) return JSON.parse(cached) as SciteRecord;
  } catch {
    // A cache miss or a cache fault: ask Scite.
  }
  let record: SciteRecord;
  try {
    const response = await get(`${sciteBaseUrl()}/papers/${doi.split('/').map(encodeURIComponent).join('/')}`, {
      headers: { Accept: 'application/json', Authorization: `Bearer ${config.discovery.sciteApiKey.trim()}` },
      timeout: 8000,
    });
    record = parseSciteRecord(doi, response.data);
  } catch (err) {
    const status = (err as { response?: { status?: number } })?.response?.status;
    record = { known: false, doi, reason: status === 404 ? 'not_found' : status === 401 || status === 403 || status === 402 || status === 429 ? 'refused' : 'unavailable' };
    logger.debug('[scite] no record read for a DOI', { doi, ...safeFailureRecord(err) });
    return record;
  }
  if (record.known) {
    try {
      await getRedis().set(cacheKey, JSON.stringify(record), 'EX', CACHE_TTL_SECONDS);
    } catch {
      // Not cached; the answer still stands.
    }
  }
  return record;
}

/** What Scite's record says was published about the work afterwards, in the DOI check's terms. A retraction outranks a correction. */
export function sciteEditorialKind(record: SciteRecord): 'retracted' | 'corrected' | null {
  if (!record.known) return null;
  const statuses = record.notices.map((n) => n.status.toLowerCase());
  if (record.retracted === true || statuses.some((s) => /retract|withdraw|removal/.test(s))) return 'retracted';
  if (statuses.some((s) => /correct|errat/.test(s))) return 'corrected';
  return null;
}
