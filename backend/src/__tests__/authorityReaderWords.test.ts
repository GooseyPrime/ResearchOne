/**
 * Slice 6, part 3. Where the reader sees authority: a source the provider
 * recorded only as a web page is named by where it was read ("government page",
 * "news article"), in the reference list, the citation card and the Evidence
 * tab, and only for a run that had the switch on. The harness measures the share
 * of citations from the top two tiers.
 */
import { describe, expect, it } from 'vitest';
import { AUTHORITY_RULES } from '../config/authorityTiers';
import { sourceKindInWords } from '../services/formatting/referenceList';
import { buildReaderEvidence } from '../services/formatting/readerEvidence';
import { sourcesByNumber } from '../services/formatting/lockedReportExport';
import { scoreAuthorityShare } from '../services/eval/scoreReport';
import { authorityRuleFor } from '../services/authority/authorityTier';

describe('a source named in words by where it was read', () => {
  it.each(AUTHORITY_RULES.filter((rule) => rule.readerWords).map((rule) => [rule.id, rule] as const))('%s names its example', (_id, rule) => {
    // Only the address counts here: what a reader is told follows from where the page was read.
    if (authorityRuleFor({ url: rule.example.url })?.id !== rule.id) return;
    // A page the base wording already names more closely ("patent record") keeps that name.
    const base = sourceKindInWords({ url: rule.example.url });
    expect(sourceKindInWords({ url: rule.example.url, authorityWords: true })).toBe(base === 'web page' ? rule.readerWords : base);
  });

  it('only address rules carry reader words, and none is a tier', () => {
    for (const rule of AUTHORITY_RULES) {
      if (rule.readerWords) {
        expect(rule.hosts || rule.hostSuffixes).toBeTruthy();
        expect(rule.readerWords).not.toMatch(/tier|\b[1-4]\b|authority/i);
      }
    }
  });

  it('applies only with the switch on, and only to a plain web page', () => {
    const regulator = { url: 'https://www.nrc.gov/reactors/x.html' };
    expect(sourceKindInWords(regulator)).toBe('web page');
    expect(sourceKindInWords({ ...regulator, authorityWords: true })).toBe('government page');
    expect(sourceKindInWords({ url: 'https://www.reuters.com/x', authorityWords: true })).toBe('news site page');
    // What the provider recorded stays.
    expect(sourceKindInWords({ kind: 'dataset', url: 'https://data.gov/x', authorityWords: true })).toBe('dataset');
    // An unknown site stays a web page.
    expect(sourceKindInWords({ url: 'https://someones-blog.example.com/x', authorityWords: true })).toBe('web page');
  });

  it('reaches the Evidence tab and the citation card for a run with the switch on', () => {
    const row = {
      section_id: null, chunk_id: 'c1', claim_id: null, source_id: 's1', citation_text: '[1]', citation_order: 1, chunk_quote: 'q',
      source_title: 'New reactors', source_url: 'https://www.nrc.gov/reactors/x.html', source_authors: null, source_publication: 'NRC',
      source_published_at: null, source_filename: null, source_kind: null, source_provider: null,
    };
    const build = (authorityWords: boolean) =>
      buildReaderEvidence({ status: { word: 'Ready', reason: null }, citationRows: [row] as never, claimRows: [], authorityWords });
    expect(build(true).sources[0].kind).toBe('government page');
    expect(build(false).sources[0].kind).toBe('web page');
  });

  it('reaches a rebuilt reference list the same way', () => {
    const rows = [{ citation_text: '[1]', title: 'New reactors', authors: null, publication: null, published_at: null, url: 'https://www.nrc.gov/x', original_filename: null, retrieval_timestamp: null, provider: null }];
    expect(sourcesByNumber(rows, { authorityWords: true })?.[0].kind).toBe('government page');
    expect(sourcesByNumber(rows)?.[0].kind).toBe('web page');
  });
});

describe('authority share in the harness', () => {
  const c = (authorityTier: number | null | undefined) => ({ alias: '', chunkQuote: '', chunkText: '', ...(authorityTier === undefined ? {} : { authorityTier }) });

  it('is the share of citations from the top two tiers', () => {
    expect(scoreAuthorityShare([c(1), c(2), c(3), c(null)])).toBe(0.5);
    expect(scoreAuthorityShare([c(4), c(4)])).toBe(0);
  });

  it('is not measured with no citations or no tiers read', () => {
    expect(scoreAuthorityShare([])).toBeNull();
    expect(scoreAuthorityShare([c(undefined), c(undefined)])).toBeNull();
  });
});

describe('review fixes for where the reader sees authority', () => {
  it('a standards body\'s own site is a standards body page, not a published standard', () => {
    expect(sourceKindInWords({ url: 'https://www.w3.org/', authorityWords: true })).toBe('standards body page');
  });

  it('a named research institution is not called a university page', () => {
    expect(sourceKindInWords({ url: 'https://www.brookings.edu/articles/x/', authorityWords: true })).toBe('research institution page');
    expect(sourceKindInWords({ url: 'https://energy.mit.edu/x', authorityWords: true })).toBe('university page');
  });

  it('a host names the site, never a document type it cannot know', () => {
    // A publisher's book list, a news homepage and a preprint server's front page are not articles.
    expect(sourceKindInWords({ url: 'https://www.cambridge.org/core/books', authorityWords: true })).toBe('journal publisher page');
    expect(sourceKindInWords({ url: 'https://www.reuters.com/', authorityWords: true })).toBe('news site page');
    expect(sourceKindInWords({ url: 'https://www.biorxiv.org/', authorityWords: true })).toBe('preprint server page');
    for (const rule of AUTHORITY_RULES) {
      if (rule.readerWords) expect(rule.readerWords).not.toMatch(/\barticle\b|\breport\b|^preprint$|\bstandard$/i);
    }
  });

  it('a renamed web page keeps its access date in every style', async () => {
    const { formatReferenceList } = await import('../services/formatting/referenceList');
    const rows = [{ citation_text: '[1]', title: 'New reactors', authors: null, publication: 'NRC', published_at: null, url: 'https://www.nrc.gov/x', original_filename: null, retrieval_timestamp: '2026-10-04T12:00:00Z', provider: null }];
    const sources = sourcesByNumber(rows, { authorityWords: true });
    expect(sources?.[0].kind).toBe('government page');
    for (const style of ['numeric', 'apa', 'mla', 'chicago-author-date', 'chicago-note', 'ieee', 'harvard'] as const) {
      const plain = formatReferenceList(sourcesByNumber(rows) ?? [], style);
      const renamed = formatReferenceList(sources ?? [], style);
      // The same dated entry, only the kind named differently where the style names it.
      expect(/2026|Oct|October/.test(renamed)).toBe(/2026|Oct|October/.test(plain));
      expect(/2026|Oct|October/.test(plain)).toBe(true);
    }
  });
});
