import { config } from '../../config';
import { clampCrawlLayers } from '../ingestion/siteCrawl';

export interface SupplementalUrlCrawlInput {
  siteCrawl?: boolean;
  crawlLayers?: number;
}

export interface ResolvedSupplementalUrlCrawl {
  siteCrawl: boolean;
  crawlLayers?: number;
}

export type SupplementalUrlCrawlParseError = 'invalid_json' | 'invalid_crawl_layers';

export type SupplementalUrlCrawlParseResult =
  | { ok: true; crawl: ResolvedSupplementalUrlCrawl }
  | { ok: false; error: SupplementalUrlCrawlParseError };

/** Parse optional site-crawl flags from a research start payload (JSON or multipart fields). */
export function parseSupplementalUrlCrawlFromBody(
  raw: unknown,
  jsonField?: SupplementalUrlCrawlInput | null
): SupplementalUrlCrawlParseResult {
  let parsed: SupplementalUrlCrawlInput | null = null;

  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as SupplementalUrlCrawlInput;
    } catch {
      return { ok: false, error: 'invalid_json' };
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as SupplementalUrlCrawlInput;
  } else if (jsonField) {
    parsed = jsonField;
  }

  if (!parsed || parsed.siteCrawl !== true) {
    return { ok: true, crawl: { siteCrawl: false } };
  }

  const layers = clampCrawlLayers(
    parsed.crawlLayers ?? 2,
    config.ingestion.siteCrawlMaxLayers
  );
  if (layers === null || layers < 2) {
    return { ok: false, error: 'invalid_crawl_layers' };
  }

  return { ok: true, crawl: { siteCrawl: true, crawlLayers: layers } };
}

export function supplementalUrlCrawlErrorMessage(
  error: SupplementalUrlCrawlParseError,
  maxLayers: number = config.ingestion.siteCrawlMaxLayers
): string {
  if (error === 'invalid_json') {
    return 'supplementalUrlCrawl must be valid JSON with siteCrawl and optional crawlLayers';
  }
  return `crawlLayers must be an integer from 2 to ${maxLayers} when site crawl is enabled`;
}
