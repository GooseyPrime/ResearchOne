import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  config: { ingestion: { siteCrawlMaxLayers: 5 } },
}));

import { parseSupplementalUrlCrawlFromBody } from '../services/research/supplementalUrlCrawl';

describe('parseSupplementalUrlCrawlFromBody', () => {
  it('returns disabled when site crawl is off', () => {
    expect(parseSupplementalUrlCrawlFromBody({ siteCrawl: false })).toEqual({ siteCrawl: false });
    expect(parseSupplementalUrlCrawlFromBody(null)).toEqual({ siteCrawl: false });
  });

  it('parses enabled crawl from JSON string', () => {
    expect(
      parseSupplementalUrlCrawlFromBody(JSON.stringify({ siteCrawl: true, crawlLayers: 3 }))
    ).toEqual({ siteCrawl: true, crawlLayers: 3 });
  });

  it('returns undefined for invalid layers when crawl enabled', () => {
    expect(parseSupplementalUrlCrawlFromBody({ siteCrawl: true, crawlLayers: 1 })).toBeUndefined();
  });

  it('clamps crawl layers to max', () => {
    expect(
      parseSupplementalUrlCrawlFromBody({ siteCrawl: true, crawlLayers: 99 })
    ).toEqual({ siteCrawl: true, crawlLayers: 5 });
  });
});
