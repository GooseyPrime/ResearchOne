import { describe, expect, it, vi } from 'vitest';

vi.mock('../config', () => ({
  config: { ingestion: { siteCrawlMaxLayers: 5 } },
}));

import {
  parseSupplementalUrlCrawlFromBody,
  supplementalUrlCrawlErrorMessage,
} from '../services/research/supplementalUrlCrawl';

describe('parseSupplementalUrlCrawlFromBody', () => {
  it('returns disabled when site crawl is off', () => {
    expect(parseSupplementalUrlCrawlFromBody({ siteCrawl: false })).toEqual({
      ok: true,
      crawl: { siteCrawl: false },
    });
    expect(parseSupplementalUrlCrawlFromBody(null)).toEqual({
      ok: true,
      crawl: { siteCrawl: false },
    });
  });

  it('parses enabled crawl from JSON string', () => {
    expect(
      parseSupplementalUrlCrawlFromBody(JSON.stringify({ siteCrawl: true, crawlLayers: 3 }))
    ).toEqual({ ok: true, crawl: { siteCrawl: true, crawlLayers: 3 } });
  });

  it('returns invalid_crawl_layers for out-of-range layers when crawl enabled', () => {
    expect(parseSupplementalUrlCrawlFromBody({ siteCrawl: true, crawlLayers: 1 })).toEqual({
      ok: false,
      error: 'invalid_crawl_layers',
    });
  });

  it('returns invalid_json for malformed JSON strings', () => {
    expect(parseSupplementalUrlCrawlFromBody('{not json')).toEqual({
      ok: false,
      error: 'invalid_json',
    });
  });

  it('clamps crawl layers to max', () => {
    expect(parseSupplementalUrlCrawlFromBody({ siteCrawl: true, crawlLayers: 99 })).toEqual({
      ok: true,
      crawl: { siteCrawl: true, crawlLayers: 5 },
    });
  });
});

describe('supplementalUrlCrawlErrorMessage', () => {
  it('maps invalid_json and invalid_crawl_layers to distinct messages', () => {
    expect(supplementalUrlCrawlErrorMessage('invalid_json')).toMatch(/valid JSON/i);
    expect(supplementalUrlCrawlErrorMessage('invalid_crawl_layers', 5)).toMatch(/2 to 5/);
  });
});
