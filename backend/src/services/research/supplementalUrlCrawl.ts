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

/** Parse optional site-crawl flags from a research start payload (JSON or multipart fields). */
export function parseSupplementalUrlCrawlFromBody(
  raw: unknown,
  jsonField?: SupplementalUrlCrawlInput | null
): ResolvedSupplementalUrlCrawl | undefined {
  let parsed: SupplementalUrlCrawlInput | null = null;

  if (typeof raw === 'string' && raw.trim()) {
    try {
      parsed = JSON.parse(raw) as SupplementalUrlCrawlInput;
    } catch {
      return undefined;
    }
  } else if (raw && typeof raw === 'object') {
    parsed = raw as SupplementalUrlCrawlInput;
  } else if (jsonField) {
    parsed = jsonField;
  }

  if (!parsed || parsed.siteCrawl !== true) {
    return { siteCrawl: false };
  }

  const layers = clampCrawlLayers(
    parsed.crawlLayers ?? 2,
    config.ingestion.siteCrawlMaxLayers
  );
  if (layers === null || layers < 2) {
    return undefined;
  }

  return { siteCrawl: true, crawlLayers: layers };
}
