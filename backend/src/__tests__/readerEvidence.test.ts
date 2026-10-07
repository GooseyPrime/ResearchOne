/**
 * Slice 5: what the reading page is given beside the report text. Strength,
 * source type and status reach a reader as words, never as stored values.
 */
import { describe, expect, it } from 'vitest';
import { buildReaderEvidence, readerStatus, strengthInWords } from '../services/formatting/readerEvidence';

const RAW = /established_fact|strong_evidence|testimony|inference|speculation|under_review|contract_failed|verification_failed|completed_degraded|no_evidence|_/;

describe('strength in words', () => {
  it.each(['established_fact', 'strong_evidence', 'testimony', 'inference', 'speculation', 'something_else', null])('never returns the stored value for %s', (tier) => {
    const words = strengthInWords(tier);
    expect(words.length).toBeGreaterThan(10);
    expect(words).not.toMatch(RAW);
  });
});

describe('the status a person reads', () => {
  it('is Ready for a finalised report', () => {
    expect(readerStatus({ reportStatus: 'finalized', runStatus: 'completed', gateStatus: 'completed' })).toEqual({ word: 'Ready', reason: null });
    expect(readerStatus({ reportStatus: 'finalized' })).toEqual({ word: 'Ready', reason: null });
  });

  it('is Needs review, with a plain reason, for a report kept back by a check', () => {
    const status = readerStatus({ reportStatus: 'under_review', runStatus: 'failed', gateStatus: 'contract_failed' });
    expect(status.word).toBe('Needs review');
    expect(status.reason).toContain('did not deliver everything the request asked for');
    expect(readerStatus({ reportStatus: 'under_review' }).word).toBe('Needs review');
    expect(readerStatus({ reportStatus: 'under_review', gateStatus: 'completed_degraded' }).reason).toContain('fewer sources');
  });

  it('is Failed when there was nothing to write from, or the run did not finish', () => {
    expect(readerStatus({ reportStatus: 'under_review', gateStatus: 'no_evidence' }).word).toBe('Failed');
    expect(readerStatus({ reportStatus: null, runStatus: 'failed' }).word).toBe('Failed');
  });

  it('a run that failed after its report was finalised is not Ready, and one that failed mid-draft is not In progress', () => {
    expect(readerStatus({ reportStatus: 'finalized', runStatus: 'failed', gateStatus: 'completed' }).word).toBe('Failed');
    expect(readerStatus({ reportStatus: 'finalized', runStatus: 'aborted' }).word).toBe('Failed');
    expect(readerStatus({ reportStatus: 'finalized', runStatus: 'cancelled' }).word).toBe('Failed');
    expect(readerStatus({ reportStatus: 'generating', runStatus: 'failed' }).word).toBe('Failed');
    expect(readerStatus({ reportStatus: 'draft', gateStatus: 'contract_failed' }).word).toBe('Needs review');
    expect(readerStatus({ reportStatus: 'generating', runStatus: 'running' }).word).toBe('In progress');
  });

  it.each([
    { reportStatus: 'under_review', gateStatus: 'verification_failed' },
    { reportStatus: 'under_review', gateStatus: 'not_a_gate' },
    { reportStatus: 'generating' },
    { reportStatus: 'archived', runStatus: 'aborted' },
  ])('never shows a stored value: %o', (args) => {
    const status = readerStatus(args);
    expect(`${status.word} ${status.reason ?? ''}`).not.toMatch(RAW);
  });
});

const row = (over: Record<string, unknown>) => ({
  section_id: 's1',
  chunk_id: 'c1',
  claim_id: null,
  source_id: 'src1',
  citation_text: '[1]',
  citation_order: 0,
  chunk_quote: ' the quoted passage ',
  source_title: 'A study',
  source_url: 'https://doi.org/10.1000/abc',
  source_authors: ['Frangoul, H.'],
  source_publication: 'NEJM',
  source_published_at: new Date('2023-12-08T00:00:00Z'),
  source_filename: null,
  source_kind: 'journal article',
  source_provider: 'pmc',
  ...over,
});

describe('the reading page data', () => {
  const built = buildReaderEvidence({
    status: { word: 'Ready', reason: null },
    citationRows: [
      row({ citation_order: 1, citation_text: '[2]', source_id: 'src2', chunk_id: 'c2', source_title: '  ', source_url: 'https://example.org/page', source_kind: null, source_provider: null, source_publication: null, source_authors: null, source_published_at: null, editorial_notice: 'The publisher has retracted this work.' }),
      row({}),
      row({ citation_order: 2, chunk_quote: 'a later passage', claim_id: 'claim1' }),
    ] as never,
    claimRows: [
      { id: 'claim1', claim_text: 'The trial met its endpoint [strong_evidence].', evidence_tier: 'strong_evidence', source_id: 'src1', chunk_id: 'c1' },
      { id: 'claim2', claim_text: 'An uncited aside.', evidence_tier: 'inference', source_id: 'elsewhere', chunk_id: 'c9' },
      // From a source the report cites, but drawn from a passage it never cites: not this report's finding.
      { id: 'claim3', claim_text: 'Another statement from the same article.', evidence_tier: 'testimony', source_id: 'src1', chunk_id: 'c7' },
      // Bound by its passage alone, to a citation of a different source record.
      { id: 'claim4', claim_text: 'A finding cited through its passage.', evidence_tier: 'established_fact', source_id: 'elsewhere', chunk_id: 'c2' },
    ],
  });

  it('lists citations in reading order with the number shown and the passage behind it', () => {
    expect(built.citations.map((citation) => [citation.order, citation.number, citation.quote, citation.sourceId])).toEqual([
      [0, 1, 'the quoted passage', 'src1'],
      [1, 2, 'the quoted passage', 'src2'],
      [2, 1, 'a later passage', 'src1'],
    ]);
  });

  it('lists each source once, with its details and its kind in words', () => {
    expect(built.sources).toEqual([
      { id: 'src1', title: 'A study', publisher: 'NEJM', authors: ['Frangoul, H.'], date: '2023-12-08', url: 'https://doi.org/10.1000/abc', kind: 'journal article', notice: null },
      { id: 'src2', title: 'Untitled source', publisher: null, authors: [], date: null, url: 'https://example.org/page', kind: 'web page', notice: 'The publisher has retracted this work.' },
    ]);
  });

  it('lists a finding only when a citation of this report is bound to it, with those citations as its sources and passages', () => {
    expect(built.findings.map((finding) => finding.text)).toEqual(['The trial met its endpoint.', 'A finding cited through its passage.']);
    const [first, second] = built.findings;
    expect(first.text).not.toContain('strong_evidence');
    expect(first.strength).toBe(strengthInWords('strong_evidence'));
    // Bound by the finding itself (the later citation) and by its passage (the first one).
    expect(first.sourceIds).toEqual(['src1']);
    expect(first.quotes).toEqual(['the quoted passage', 'a later passage']);
    // Its sources are the citations', not the record the finding was extracted under.
    expect(second.sourceIds).toEqual(['src2']);
    expect(second.strength).toBe(strengthInWords('established_fact'));
  });

  it('holds no stored grade or status anywhere', () => {
    expect(JSON.stringify(built)).not.toMatch(/established_fact|strong_evidence|"inference"|evidence_tier|under_review/);
  });

  it('a run that stored no findings still gives every cited passage with its source', () => {
    const lookup = buildReaderEvidence({ status: { word: 'Ready', reason: null }, citationRows: [row({})] as never, claimRows: [] });
    expect(lookup.findings).toEqual([]);
    expect(lookup.citations[0].quote).toBe('the quoted passage');
    expect(lookup.sources[0].title).toBe('A study');
  });
});
