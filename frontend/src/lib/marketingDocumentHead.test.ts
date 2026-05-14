/** @vitest-environment jsdom */
import { describe, it, expect } from 'vitest';
import { applyMarketingDocumentHead, resolveMarketingHead } from '@/lib/marketingDocumentHead';

describe('resolveMarketingHead', () => {
  it('returns methodology-specific copy for /methodology', () => {
    const h = resolveMarketingHead('/methodology');
    expect(h.title).toContain('Methodology');
    expect(h.ogTitle).toContain('Methodology');
    expect(h.description).not.toEqual(resolveMarketingHead('/').description);
  });

  it('normalizes trailing slash', () => {
    expect(resolveMarketingHead('/pricing/')).toEqual(resolveMarketingHead('/pricing'));
  });
});

describe('applyMarketingDocumentHead', () => {
  it('writes distinct og:title for methodology vs home', () => {
    applyMarketingDocumentHead('/');
    const homeOg = document.querySelector('meta[property="og:title"]')?.getAttribute('content');

    applyMarketingDocumentHead('/methodology');
    const methOg = document.querySelector('meta[property="og:title"]')?.getAttribute('content');

    expect(homeOg).toBeTruthy();
    expect(methOg).toBeTruthy();
    expect(homeOg).not.toEqual(methOg);
    expect(document.title).toContain('Methodology');
  });
});
