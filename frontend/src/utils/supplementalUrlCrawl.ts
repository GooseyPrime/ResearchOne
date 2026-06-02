export interface SupplementalUrlCrawlPayload {
  siteCrawl: boolean;
  crawlLayers: number;
}

export function supplementalUrlCrawlPayload(
  enabled: boolean,
  crawlLayers: number
): SupplementalUrlCrawlPayload | undefined {
  if (!enabled) return undefined;
  return { siteCrawl: true, crawlLayers };
}
