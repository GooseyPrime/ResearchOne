import { describe, expect, it } from 'vitest';
import { scoreStoredReport } from '../services/eval/scoreReport';
import { loadEvalTasks } from '../services/eval/taskSet';

describe('eval scorers', () => {
  it('scores a dangling alias below 1', () => {
    const scores = scoreStoredReport({
      reportMarkdown: 'The finding holds [E9].',
      citations: [{ alias: 'E1', chunkQuote: 'a quote', chunkText: 'a quote in the chunk' }],
    });
    expect(scores.citation_bound).toBeLessThan(1);
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

  it('loads the frozen 30-task set', () => {
    const tasks = loadEvalTasks();
    expect(tasks).toHaveLength(30);
    expect(tasks.filter((task) => task.kind === 'factual')).toHaveLength(15);
    expect(tasks.filter((task) => task.kind === 'survey')).toHaveLength(8);
    expect(tasks.filter((task) => task.kind === 'challenge')).toHaveLength(7);
  });
});
