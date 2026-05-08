import axios from 'axios';
import { config } from '../../../config';
import { logger } from '../../../utils/logger';
import { getRedis } from '../../../queue/redis';

const CACHE_TTL_SECONDS = 86400; // 24 hours

interface InstitutionalStatusResponse {
  status?: 'active' | 'retracted' | 'editorial_concern' | 'corrected';
}

interface CitationCountsResponse {
  supporting?: number;
  contrasting?: number;
  mentioning?: number;
}

interface ContrastingPapersResponse {
  dois?: string[];
  papers?: Array<{ doi?: string }>;
}

function sciteHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${config.discovery.sciteApiKey}`,
    Accept: 'application/json',
  };
}

function sciteUrl(path: string): string {
  return `${config.discovery.sciteBaseUrl}${path}`;
}

export async function getInstitutionalStatus(
  doi: string,
): Promise<{ status: 'active' | 'retracted' | 'editorial_concern' | 'corrected' }> {
  const cacheKey = `scite:status:${doi}`;

  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn('[scite] Redis cache read failed for status:', err);
  }

  try {
    const response = await axios.get<InstitutionalStatusResponse>(
      sciteUrl(`/papers/${encodeURIComponent(doi)}/status`),
      {
        headers: sciteHeaders(),
        timeout: 10000,
      },
    );

    const result = {
      status: response.data.status ?? 'active',
    } as const;

    try {
      const redis = getRedis();
      await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn('[scite] Redis cache write failed for status:', err);
    }

    return result;
  } catch (err) {
    logger.warn(`[scite] Failed to fetch institutional status for ${doi}:`, err);
    return { status: 'active' };
  }
}

export async function getCitationCounts(
  doi: string,
): Promise<{ supporting: number; contrasting: number; mentioning: number }> {
  const cacheKey = `scite:counts:${doi}`;

  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn('[scite] Redis cache read failed for counts:', err);
  }

  try {
    const response = await axios.get<CitationCountsResponse>(
      sciteUrl(`/papers/${encodeURIComponent(doi)}/tallies`),
      {
        headers: sciteHeaders(),
        timeout: 10000,
      },
    );

    const result = {
      supporting: response.data.supporting ?? 0,
      contrasting: response.data.contrasting ?? 0,
      mentioning: response.data.mentioning ?? 0,
    };

    try {
      const redis = getRedis();
      await redis.set(cacheKey, JSON.stringify(result), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn('[scite] Redis cache write failed for counts:', err);
    }

    return result;
  } catch (err) {
    logger.warn(`[scite] Failed to fetch citation counts for ${doi}:`, err);
    return { supporting: 0, contrasting: 0, mentioning: 0 };
  }
}

export async function getContrastingPaperDois(doi: string): Promise<string[]> {
  const cacheKey = `scite:contrasting:${doi}`;

  try {
    const redis = getRedis();
    const cached = await redis.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }
  } catch (err) {
    logger.warn('[scite] Redis cache read failed for contrasting:', err);
  }

  try {
    const response = await axios.get<ContrastingPapersResponse>(
      sciteUrl(`/papers/${encodeURIComponent(doi)}/contrasting`),
      {
        headers: sciteHeaders(),
        timeout: 10000,
      },
    );

    const dois: string[] = response.data.dois
      ?? response.data.papers?.map((p) => p.doi).filter((d): d is string => Boolean(d))
      ?? [];

    try {
      const redis = getRedis();
      await redis.set(cacheKey, JSON.stringify(dois), 'EX', CACHE_TTL_SECONDS);
    } catch (err) {
      logger.warn('[scite] Redis cache write failed for contrasting:', err);
    }

    return dois;
  } catch (err) {
    logger.warn(`[scite] Failed to fetch contrasting papers for ${doi}:`, err);
    return [];
  }
}
