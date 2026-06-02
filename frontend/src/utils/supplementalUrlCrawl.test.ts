import { describe, expect, it } from 'vitest';
import { supplementalUrlCrawlPayload } from './supplementalUrlCrawl';

describe('supplementalUrlCrawlPayload', () => {
  it('returns undefined when crawl is disabled', () => {
    expect(supplementalUrlCrawlPayload(false, 2)).toBeUndefined();
  });

  it('returns crawl payload when enabled', () => {
    expect(supplementalUrlCrawlPayload(true, 3)).toEqual({ siteCrawl: true, crawlLayers: 3 });
  });
});
