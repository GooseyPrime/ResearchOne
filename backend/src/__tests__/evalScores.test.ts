import { describe, expect, it } from 'vitest';
import { scoreStoredReport } from '../services/eval/scoreReport';
import { loadEvalTasks } from '../services/eval/taskSet';

describe('eval scorers', () => {
  it('scores a locked report that cites only with an export alias as unbound', () => {
    const scores = scoreStoredReport({
      reportMarkdown: 'The finding holds [E1].',
      citations: [{ alias: '[E1]', chunkQuote: 'a quote', chunkText: 'a quote in the chunk', chunkId: 'chunk-1' }],
      citationLock: true,
    });
    expect(scores.citation_bound).toBe(0);
  });

  it('lowers the score of a locked report that has a saved row its text does not show', () => {
    const numbered = { alias: '', chunkQuote: 'a quote', chunkText: 'a quote in the chunk', chunkId: 'chunk-1', citationText: '[1]' };
    const report = 'The finding holds [1].';
    expect(scoreStoredReport({ reportMarkdown: report, citations: [numbered], citationLock: true }).citation_bound).toBe(1);
    const extra = { alias: '', chunkQuote: 'a quote', chunkText: 'a quote in the chunk', chunkId: 'chunk-2', citationText: null };
    expect(scoreStoredReport({ reportMarkdown: report, citations: [numbered, extra], citationLock: true }).citation_bound).toBe(0.5);
    expect(scoreStoredReport({ reportMarkdown: report, citations: [extra, numbered], citationLock: true }).citation_bound).toBe(0);
  });

  it('scores a stored report that has no alias markers from its citation rows', () => {
    const scores = scoreStoredReport({
      reportMarkdown: 'The FDA authorized Casgevy in 2023 for sickle cell disease.',
      citations: [
        {
          alias: '',
          chunkId: 'chunk-1',
          chunkQuote: 'FDA approved Casgevy',
          chunkText: 'The FDA approved Casgevy for sickle cell disease.',
          citationText: 'The FDA authorized Casgevy in 2023.',
        },
      ],
    });
    expect(scores.citation_bound).toBe(1);
    expect(scores.quote_verbatim).toBe(1);
  });

  it('scores a quote that is not in the chunk below 1', () => {
    const scores = scoreStoredReport({
      reportMarkdown: 'The finding holds [E1].',
      citations: [{ alias: 'E1', chunkQuote: 'not in the chunk', chunkText: 'a different stored passage' }],
    });
    expect(scores.quote_verbatim).toBeLessThan(1);
  });

  it('scores three of four key facts as 0.75', () => {
    const scores = scoreStoredReport({
      reportMarkdown: '2023 Casgevy was authorized for sickle cell disease.',
      citations: [],
      keyFacts: ['2023', 'Casgevy', 'sickle cell', 'exa-cel'],
    });
    expect(scores.answer_correct).toBe(0.75);
  });

  it('scores a report with no citations as unbound and not verbatim', () => {
    const scores = scoreStoredReport({
      reportMarkdown: 'A finished report with no citations.',
      citations: [],
    });
    expect(scores.citation_bound).toBe(0);
    expect(scores.quote_verbatim).toBe(0);
    expect(scores.doi_resolution).toBeNull();
  });

  it('keeps a contradiction only when the row links both fixture documents', () => {
    const kept = scoreStoredReport({
      reportMarkdown: 'The accounts disagree.',
      citations: [{ alias: 'E1', chunkQuote: 'quoted', chunkText: 'quoted in the chunk' }],
      fixtureSides: ['challenge-rail-budget-side-a.txt', 'challenge-rail-budget-side-b.txt'],
      contradictionLinks: [
        { documentA: 'challenge-rail-budget-side-a.txt', documentB: 'challenge-rail-budget-side-b.txt' },
      ],
    });
    const wordingOnly = scoreStoredReport({
      reportMarkdown: 'the audit says the overrun was change orders; the agency says it was steel prices',
      citations: [{ alias: 'E1', chunkQuote: 'quoted', chunkText: 'quoted in the chunk' }],
      fixtureSides: ['challenge-rail-budget-side-a.txt', 'challenge-rail-budget-side-b.txt'],
      contradictionLinks: [
        { documentA: 'challenge-rail-budget-side-a.txt', documentB: 'challenge-rail-budget-side-a.txt' },
      ],
    });
    expect(kept.contradiction_retention).toBe(1);
    expect(wordingOnly.contradiction_retention).toBe(0);
  });

  it('gives each challenge task two disagreeing documents and an anomaly document', () => {
    const challenges = loadEvalTasks().filter((task) => task.kind === 'challenge');
    expect(challenges).toHaveLength(7);
    for (const task of challenges) {
      expect(task.fixtureDocuments?.map((doc) => doc.role)).toEqual(['side_a', 'side_b', 'anomaly']);
    }
  });
});
