/**
 * Slice 6. Every rule in config/authorityTiers.ts is run through its own
 * example, so a rule cannot exist untested, and the order of the rules is
 * checked where two could claim the same source.
 */
import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { AUTHORITY_RULES } from '../config/authorityTiers';
import { authorityRuleFor, authorityTierFor, storedAuthorityTier } from '../services/authority/authorityTier';

describe('each authority rule', () => {
  it('has an id of its own', () => {
    const ids = AUTHORITY_RULES.map((rule) => rule.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(AUTHORITY_RULES.map((rule) => [rule.id, rule] as const))('%s decides its own example', (_id, rule) => {
    expect(rule.example).toBeTruthy();
    expect(authorityRuleFor(rule.example)?.id).toBe(rule.id);
    expect(authorityTierFor(rule.example)).toBe(rule.tier);
  });

  it.each(AUTHORITY_RULES.map((rule) => [rule.id, rule] as const))('%s matches on one thing only', (_id, rule) => {
    // A rule is by kind, by provider, or by address. Mixing them would hide which one decided.
    const by = [Boolean(rule.kinds), Boolean(rule.providers), Boolean(rule.hosts || rule.hostSuffixes)].filter(Boolean);
    expect(by).toHaveLength(1);
  });
});

describe('the tiers the plan names', () => {
  it('a government regulator page is tier 1', () => {
    expect(authorityTierFor({ url: 'https://www.nrc.gov/reactors/new-reactors.html' })).toBe(1);
    expect(authorityTierFor({ url: 'https://www.fda.gov/drugs/example' })).toBe(1);
    expect(authorityTierFor({ url: 'https://www.ofgem.gov.uk/publications/example' })).toBe(1);
  });

  it('a Crossref journal article is tier 2', () => {
    expect(authorityTierFor({ provider: 'crossref', kind: 'journal article', url: 'https://doi.org/10.1016/j.enpol.2016.01.011' })).toBe(2);
  });

  it('an arXiv preprint is tier 3', () => {
    expect(authorityTierFor({ provider: 'arxiv', kind: 'preprint', url: 'https://arxiv.org/abs/2401.00001' })).toBe(3);
    expect(authorityTierFor({ url: 'https://arxiv.org/abs/2401.00001' })).toBe(3);
  });

  it('an unknown blog is tier 4', () => {
    expect(authorityTierFor({ url: 'https://someones-energy-blog.example.com/post/1' })).toBe(4);
    expect(authorityRuleFor({ url: 'https://someones-energy-blog.example.com/post/1' })).toBeNull();
  });
});

describe('order and edges', () => {
  it('what the work is comes before where it is hosted', () => {
    // A journal article on a government host is a journal article.
    expect(authorityTierFor({ url: 'https://www.ncbi.nlm.nih.gov/pmc/articles/PMC1234567/' })).toBe(2);
    expect(authorityTierFor({ url: 'https://pubmed.ncbi.nlm.nih.gov/12345678/' })).toBe(2);
    // Another page on the same government host is a government page.
    expect(authorityTierFor({ url: 'https://www.ncbi.nlm.nih.gov/books/about/' })).toBe(1);
    // A preprint with a DOI is a preprint, not a journal article.
    expect(authorityTierFor({ provider: 'crossref', kind: 'preprint', url: 'https://www.nature.com/articles/x' })).toBe(3);
  });

  it('a catalogue entry with no recorded kind is not called peer reviewed', () => {
    expect(authorityTierFor({ provider: 'crossref', url: 'https://doi.org/10.1234/x' })).toBe(3);
    expect(authorityTierFor({ provider: 'openalex' })).toBe(3);
    // With a kind, the kind decides.
    expect(authorityTierFor({ provider: 'openalex', kind: 'dataset' })).toBe(1);
  });

  it('a look-alike host does not borrow a tier', () => {
    expect(authorityTierFor({ url: 'https://nrc.gov.example.com/page' })).toBe(4);
    expect(authorityTierFor({ url: 'https://evil-nature.com/articles/x' })).toBe(4);
    expect(authorityTierFor({ url: 'https://notgov/page' })).toBe(4);
    expect(authorityTierFor({ url: 'https://gov/page' })).toBe(4);
  });

  it('ignores "www.", letter case and a trailing dot', () => {
    expect(authorityTierFor({ url: 'HTTPS://WWW.Reuters.com./business/x' })).toBe(3);
    expect(authorityTierFor({ provider: ' CrossRef ', kind: ' Journal Article ' })).toBe(2);
  });

  it('a source with nothing to judge by is unranked, not ranked last', () => {
    expect(authorityTierFor({})).toBeNull();
    expect(authorityTierFor({ url: null, provider: null, kind: null })).toBeNull();
    expect(authorityTierFor({ url: 'not a url' })).toBeNull();
    expect(authorityTierFor({ url: 'file:///C:/notes.pdf' })).toBeNull();
    // A general web search names itself as provider; the page is still judged by its address.
    expect(authorityTierFor({ provider: 'tavily', url: 'https://example.org/x' })).toBe(4);
  });

  it('reads a stored tier back as 1 to 4 or nothing', () => {
    expect(storedAuthorityTier(2)).toBe(2);
    expect(storedAuthorityTier('3')).toBe(3);
    expect(storedAuthorityTier(0)).toBeNull();
    expect(storedAuthorityTier(5)).toBeNull();
    expect(storedAuthorityTier(null)).toBeNull();
    expect(storedAuthorityTier('strong_evidence')).toBeNull();
  });
});

describe('migration 060', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../db/migrations/060_source_authority_tier.sql'), 'utf8');

  it('adds a nullable column that can be applied twice', () => {
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS authority_tier SMALLINT NULL/);
    expect(sql).toContain('authority_tier BETWEEN 1 AND 4');
    // The constraint check is scoped to the table it is added to.
    expect(sql).toContain("rel.relname = 'sources'");
    expect(sql).not.toMatch(/NOT NULL|DEFAULT/);
  });
});
