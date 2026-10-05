import { describe, expect, it } from 'vitest';
import {
  assignOccurrencesToSections,
  finalizeLockedCitations,
  issuePassages,
  sameArticleSources,
  type LockedPassage,
} from '../services/reasoning/citationLock';
import { scoreCitationBound } from '../services/eval/scoreReport';

const ARTICLE_TEXT_A =
  'Reactors under construction during the 1979 accident had median overnight costs 2.8 times higher than earlier plants. The number of regulatory guides grew from 21 in 1971 to 143 in 1978.';
const ARTICLE_TEXT_B =
  'The number of regulatory guides grew from 21 in 1971 to 143 in 1978. Reactors under construction during the 1979 accident had median overnight costs 2.8 times higher than earlier plants. Subscribe for more.';

function passages(): LockedPassage[] {
  return issuePassages(
    [
      { id: 'c1', content: ARTICLE_TEXT_A },
      { id: 'c2', content: ARTICLE_TEXT_B },
      { id: 'c3', content: 'French units of the 900 MWe series were completed in 65 to 90 months.' },
      { id: 'c4', content: 'A second passage of the first article says Korean costs fell by half over four decades of building.' },
    ],
    [
      { title: 'Can America Build Nuclear Again? Part 1 - Center for Technology, Science, and Energy', url: 'https://ctse.example.org/part-1' },
      { title: 'Can America Build Nuclear Again? Part 1', url: 'https://newsletter.example.com/p/part-1' },
      { title: 'Economics of Nuclear Power', publisher: 'World Nuclear Association', url: 'https://wna.example.org/economics' },
      { title: 'Can America Build Nuclear Again? Part 1 - Center for Technology, Science, and Energy', url: 'https://ctse.example.org/part-1' },
    ],
    new Map([
      ['c1', 'source-a'],
      ['c2', 'source-b'],
      ['c3', 'source-c'],
      ['c4', 'source-a'],
    ])
  );
}

describe('numbers standing side by side', () => {
  it('shows a source once when two of its passages are cited together, with one saved citation behind it', () => {
    const finalized = finalizeLockedCitations('## Summary\nCosts rose after 1979 [P1][P4]. French units took 65 to 90 months [P3].', passages(), '4 Oct 2026');
    expect(finalized.markdown).toContain('Costs rose after 1979 [1]. French units took 65 to 90 months [2].');
    expect(finalized.occurrences.map((occurrence) => occurrence.number)).toEqual([1, 2]);
    expect(finalized.occurrences[0].chunkId).toBe('c1');
    expect(finalized.removed).toBe(0);
  });

  it('does the same inside one bracket and across a space', () => {
    const grouped = finalizeLockedCitations('## Summary\nCosts rose after 1979 [P1, P4, P3].', passages(), '4 Oct 2026');
    expect(grouped.markdown).toContain('Costs rose after 1979 [1][2].');
    const spaced = finalizeLockedCitations('## Summary\nCosts rose after 1979 [P1] [P4].', passages(), '4 Oct 2026');
    expect(spaced.markdown).toContain('Costs rose after 1979 [1].');
    expect(spaced.markdown).not.toContain('[1] .');
  });

  it('keeps a number that is cited again later in the sentence or in the next one', () => {
    const finalized = finalizeLockedCitations('## Summary\nCosts rose [P1], and Korean costs fell [P4]. Guides multiplied [P1].', passages(), '4 Oct 2026');
    expect(finalized.markdown).toContain('Costs rose [1], and Korean costs fell [1]. Guides multiplied [1].');
    expect(finalized.occurrences).toHaveLength(3);
  });

  it('keeps every number in the text backed by a saved row, in order, after a doubled number is dropped', () => {
    const finalized = finalizeLockedCitations('## Summary\nCosts rose after 1979 [P1][P4]. French units took 65 to 90 months [P3][P3].', passages(), '4 Oct 2026');
    const sections = [{ title: 'Summary', content: finalized.markdown.split('## Summary\n')[1].split('\n\n## References')[0] }];
    const bound = assignOccurrencesToSections(sections, finalized.occurrences);
    expect(bound.every((row) => row.sectionOrder === 1)).toBe(true);
    const byChunk = new Map(passages().map((passage) => [passage.chunkId, passage.text]));
    const stored = finalized.occurrences.map((occurrence) => ({
      alias: '',
      chunkQuote: occurrence.quote,
      chunkText: byChunk.get(occurrence.chunkId) ?? '',
      chunkId: occurrence.chunkId,
      citationText: `[${occurrence.number}]`,
      claimText: null,
    }));
    expect(scoreCitationBound(finalized.markdown, stored, true)).toBe(1);
  });
});

describe('one article stored from two sites', () => {
  it('recognises a copy by its title and its text together', () => {
    const copies = sameArticleSources(passages());
    expect([...copies.entries()]).toEqual([['source-b', 'source-a']]);
  });

  it('numbers and lists the two copies as one source, and counts them as one read', () => {
    const finalized = finalizeLockedCitations('## Summary\nCosts rose after 1979 [P1]. Guides multiplied [P2]. French units took 65 to 90 months [P3].', passages(), '4 Oct 2026');
    expect(finalized.markdown).toContain('Costs rose after 1979 [1]. Guides multiplied [1]. French units took 65 to 90 months [2].');
    const references = finalized.markdown.split('## References\n')[1].split('\n\n## About this report')[0].split('\n');
    expect(references).toHaveLength(2);
    expect(references[0]).toContain('https://ctse.example.org/part-1');
    expect(finalized.markdown.trimEnd().endsWith('2 sources were read on 4 Oct 2026.')).toBe(true);
    // Each citation still points at the passage it was written from.
    expect(finalized.occurrences.map((occurrence) => occurrence.chunkId)).toEqual(['c1', 'c2', 'c3']);
  });

  it('treats a copy of a copy as a copy of the first, though the first and third share no retrieved text', () => {
    const first = 'After 1979 construction costs in the United States rose sharply as rules changed during building.';
    const third = 'French units of one repeated design took between sixty five and ninety months to complete on average.';
    const chain = issuePassages(
      [
        { id: 'c1', content: first },
        { id: 'c2', content: first },
        { id: 'c3', content: third },
        { id: 'c4', content: third },
      ],
      [
        { title: 'Historical construction costs of nuclear reactors' },
        { title: 'Historical construction costs of nuclear reactors - Mirror' },
        { title: 'Historical construction costs of nuclear reactors - Mirror' },
        { title: 'Historical construction costs of nuclear reactors - Mirror - Archive' },
      ],
      new Map([
        ['c1', 'source-a'],
        ['c2', 'source-b'],
        ['c3', 'source-b'],
        ['c4', 'source-c'],
      ])
    );
    expect([...sameArticleSources(chain).entries()]).toEqual([
      ['source-b', 'source-a'],
      ['source-c', 'source-a'],
    ]);
    const finalized = finalizeLockedCitations('## Summary\nCosts rose [P1]. French units took longer [P4].', chain, '4 Oct 2026');
    expect(finalized.markdown).toContain('Costs rose [1]. French units took longer [1].');
  });

  it('keeps two articles apart when they share a title but not their text', () => {
    const apart = issuePassages(
      [
        { id: 'c1', content: 'The first annual report describes revenue growth across the northern region in detail.' },
        { id: 'c2', content: 'An unrelated annual report describes staffing changes at a hospital trust over one year.' },
      ],
      [{ title: 'Annual report and accounts 2023' }, { title: 'Annual report and accounts 2023 - Trust' }],
      new Map([
        ['c1', 'source-a'],
        ['c2', 'source-b'],
      ])
    );
    expect(sameArticleSources(apart).size).toBe(0);
  });

  it('keeps two articles apart when they quote the same text under different titles', () => {
    const apart = issuePassages(
      [
        { id: 'c1', content: ARTICLE_TEXT_A },
        { id: 'c2', content: ARTICLE_TEXT_A },
      ],
      [{ title: 'Can America Build Nuclear Again? Part 1' }, { title: 'A reply to the cost escalation argument in full' }],
      new Map([
        ['c1', 'source-a'],
        ['c2', 'source-b'],
      ])
    );
    expect(sameArticleSources(apart).size).toBe(0);
  });

  it('does not join sources on a short title', () => {
    const short = issuePassages(
      [
        { id: 'c1', content: ARTICLE_TEXT_A },
        { id: 'c2', content: ARTICLE_TEXT_A },
      ],
      [{ title: 'Home' }, { title: 'Home - Site' }],
      new Map([
        ['c1', 'source-a'],
        ['c2', 'source-b'],
      ])
    );
    expect(sameArticleSources(short).size).toBe(0);
  });
});

describe('a passage label written into a sentence', () => {
  it('replaces the label of an issued passage with plain words', () => {
    const finalized = finalizeLockedCitations(
      '## Limits of this report\nWhile P3 notes labour shortages, it gives no figures [P3]. P1 states that costs rose [P1]. Passage P4 also covers Korea [P4].',
      passages(),
      '4 Oct 2026'
    );
    expect(finalized.markdown).toContain('While one source notes labour shortages, it gives no figures [1].');
    expect(finalized.markdown).toContain('One source states that costs rose [2].');
    expect(finalized.markdown).toContain('One source also covers Korea [2].');
    expect(finalized.markdown).not.toMatch(/\bP\d+\b/);
    expect(finalized.removed).toBe(3);
  });

  it('leaves a name that only looks like a label', () => {
    // Only four passages were issued, so "P5" is not one of them; and "P1" with no verb after it is not read as a label.
    const finalized = finalizeLockedCitations('## Summary\nThe P5 states met in Geneva, and the P1 visa rules changed [P1].', passages(), '4 Oct 2026');
    expect(finalized.markdown).toContain('The P5 states met in Geneva, and the P1 visa rules changed [1].');
    expect(finalized.removed).toBe(0);
  });
});

describe('the last check before a locked report is saved', () => {
  it('puts wording a repair wrote back into plain words before the citations are numbered', async () => {
    const { finalizeLockedReportForSave } = await import('../services/reasoning/reportGenerator');
    const repaired =
      '# Nuclear construction costs\n\n## Summary\nThe evidence establishes that costs rose after 1979 [P1]. Critics claim that the series was never repeated [P3]. As noted by the quantitative quality auditor, the samples differ [P4].';
    const { finalized, wordingAfter } = finalizeLockedReportForSave(repaired, 'Why do plants cost more?', passages(), 'numeric', '4 Oct 2026');
    expect(wordingAfter).toEqual([]);
    expect(finalized.markdown).toContain('The sources show that costs rose after 1979 [1].');
    expect(finalized.markdown).toContain('Critics state that the series was never repeated [2].');
    expect(finalized.markdown).toContain('As noted by this analysis, the samples differ [1].');
    // Each citation is tied to the sentence as it is saved.
    expect(finalized.occurrences).toHaveLength(3);
  });

  it('changes nothing in a report that needs nothing changed, and writes the list in the style asked for', async () => {
    const { finalizeLockedReportForSave } = await import('../services/reasoning/reportGenerator');
    const clean = '# Nuclear construction costs\n\n## Summary\nFrench units took 65 to 90 months [P3]. The group said "these claims are false" [P1].';
    const numbered = finalizeLockedReportForSave(clean, 'q', passages(), 'numeric', '4 Oct 2026');
    expect(numbered.wordingAfter).toEqual([]);
    expect(numbered.finalized.markdown).toContain('The group said "these claims are false" [2].');
    expect(numbered.finalized.markdown).toContain('1. World Nuclear Association. Economics of Nuclear Power. https://wna.example.org/economics');
    const apa = finalizeLockedReportForSave(clean, 'q', passages(), 'apa', '4 Oct 2026');
    expect(apa.finalized.markdown).toContain('1. World Nuclear Association. (n.d.). Economics of Nuclear Power. https://wna.example.org/economics');
    expect(apa.finalized.markdown).toContain('French units took 65 to 90 months [1].');
  });

  it('removes the older labels and markers a repair can write, and has nothing left to report', async () => {
    const { finalizeLockedReportForSave } = await import('../services/reasoning/reportGenerator');
    const { finalized, wordingAfter } = finalizeLockedReportForSave(
      '## Summary\nThe unit opened in 1977 [Chunk 4] [P3]. The series was repeated [Strong_Evidence] (testimony) [P3].',
      'q',
      passages(),
      'numeric',
      '4 Oct 2026'
    );
    expect(finalized.markdown).toContain('The unit opened in 1977 [1]. The series was repeated [1].');
    expect(wordingAfter).toEqual([]);
  });
});
