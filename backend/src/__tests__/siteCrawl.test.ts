import { describe, it, expect, vi } from 'vitest';
import {
  extractSameOriginLinks,
  normalizeCrawlUrl,
  resolveSameOriginLink,
  discoverSiteCrawlUrls,
  clampCrawlLayers,
} from '../services/ingestion/siteCrawl';

describe('siteCrawl link extraction', () => {
  it('resolves relative same-origin links', () => {
    expect(resolveSameOriginLink('/about', 'https://example.com/docs', 'example.com')).toBe(
      'https://example.com/about'
    );
  });

  it('rejects cross-origin links', () => {
    expect(resolveSameOriginLink('https://other.com/x', 'https://example.com/', 'example.com')).toBeNull();
  });

  it('skips asset extensions', () => {
    expect(resolveSameOriginLink('/file.pdf', 'https://example.com/', 'example.com')).toBeNull();
  });

  it('extracts unique normalized links from HTML', () => {
    const html = `
      <a href="/one">One</a>
      <a href="https://example.com/two">Two</a>
      <a href="https://evil.com/nope">Nope</a>
      <a href="/one">Dup</a>
    `;
    const links = extractSameOriginLinks(html, 'https://example.com/', 'example.com');
    expect(links).toContain(normalizeCrawlUrl('https://example.com/one'));
    expect(links).toContain(normalizeCrawlUrl('https://example.com/two'));
    expect(links).toHaveLength(2);
  });
});

describe('clampCrawlLayers', () => {
  it('clamps to max', () => {
    expect(clampCrawlLayers(99, 5)).toBe(5);
  });

  it('rejects invalid values', () => {
    expect(clampCrawlLayers(0, 5)).toBeNull();
    expect(clampCrawlLayers('abc', 5)).toBeNull();
  });
});

describe('discoverSiteCrawlUrls', () => {
  it('returns only seed when crawlLayers is 1', async () => {
    const fetchHtml = vi.fn();
    const urls = await discoverSiteCrawlUrls({
      seedUrl: 'https://site.test/',
      crawlLayers: 1,
      maxPages: 10,
      fetchHtml,
    });
    expect(urls).toEqual(['https://site.test']);
    expect(fetchHtml).not.toHaveBeenCalled();
  });

  it('discovers second-layer links when crawlLayers is 2', async () => {
    const fetchHtml = vi.fn(async (url: string) => {
      if (url === 'https://site.test') {
        return '<a href="/child">child</a>';
      }
      return '<html></html>';
    });
    const urls = await discoverSiteCrawlUrls({
      seedUrl: 'https://site.test/',
      crawlLayers: 2,
      maxPages: 10,
      fetchHtml,
    });
    expect(urls).toContain('https://site.test');
    expect(urls).toContain('https://site.test/child');
    expect(fetchHtml).toHaveBeenCalledWith('https://site.test');
  });

  it('respects maxPages cap', async () => {
    const fetchHtml = vi.fn(async () => '<a href="/a">a</a><a href="/b">b</a><a href="/c">c</a>');
    const urls = await discoverSiteCrawlUrls({
      seedUrl: 'https://cap.test/',
      crawlLayers: 3,
      maxPages: 2,
      fetchHtml,
    });
    expect(urls.length).toBeLessThanOrEqual(2);
  });
});
