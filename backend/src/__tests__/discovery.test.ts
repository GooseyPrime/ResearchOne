import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../services/discovery/discoveryOrchestrator.test-helpers';

// Test the URL normalisation logic used for deduplication
// We test it through the exported helper for testability
describe('discovery URL normalisation', () => {
  it('strips URL fragments', () => {
    const a = normalizeUrl('https://example.com/page#section');
    const b = normalizeUrl('https://example.com/page');
    expect(a).toBe(b);
  });

  it('strips trailing slashes', () => {
    const a = normalizeUrl('https://example.com/page/');
    const b = normalizeUrl('https://example.com/page');
    expect(a).toBe(b);
  });

  it('treats the same URL without deduplication as different', () => {
    const a = normalizeUrl('https://example.com/page-a');
    const b = normalizeUrl('https://example.com/page-b');
    expect(a).not.toBe(b);
  });

  it('handles malformed URLs gracefully', () => {
    // Should not throw
    expect(() => normalizeUrl('not-a-url')).not.toThrow();
    const result = normalizeUrl('not-a-url');
    expect(result).toBeTruthy();
  });
});

describe('discovery dedup logic', () => {
  it('dedupes candidates with the same normalised URL', async () => {
    const { dedupeByUrl } = await import('../services/discovery/discoveryOrchestrator.test-helpers');
    const candidates = [
      { url: 'https://example.com/page#a', title: 'A', snippet: '', score: 0.9, rank: 1, provider: 'generic', sourceQuery: 'q' },
      { url: 'https://example.com/page#b', title: 'B', snippet: '', score: 0.8, rank: 2, provider: 'generic', sourceQuery: 'q' },
      { url: 'https://example.com/other', title: 'C', snippet: '', score: 0.7, rank: 3, provider: 'generic', sourceQuery: 'q' },
    ];
    const deduped = dedupeByUrl(candidates);
    // Both page#a and page#b normalise to the same URL — only one should remain
    expect(deduped.length).toBe(2);
  });

  it('honours max_sources_to_ingest', async () => {
    const { selectTopN } = await import('../services/discovery/discoveryOrchestrator.test-helpers');
    const candidates = Array.from({ length: 20 }, (_, i) => ({
      url: `https://example.com/page-${i}`,
      title: `Page ${i}`,
      snippet: '',
      score: 1 - i * 0.01,
      rank: i + 1,
      provider: 'generic',
      sourceQuery: 'q',
    }));
    const selected = selectTopN(candidates, 5);
    expect(selected.length).toBe(5);
    // Should pick highest scoring first
    expect(selected[0].score).toBeGreaterThanOrEqual(selected[4].score);
  });
});
