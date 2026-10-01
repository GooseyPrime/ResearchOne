import { describe, expect, it } from 'vitest';
import { judgeQuoteSupports, parseSupports } from '../services/eval/quoteSupportsJudge';
import { assertSpendConfirmed, HARNESS_CONCURRENCY, selectHarnessTasks } from '../scripts/runEvalHarness';
import { loadEvalTasks } from '../services/eval/taskSet';

describe('harness command', () => {
  it('refuses to start without spend confirmation', () => {
    expect(() => assertSpendConfirmed(['node', 'runEvalHarness.ts'])).toThrow(/confirm-spend/);
  });

  it('selects one factual, one survey, and one challenge for the pilot', () => {
    const selected = selectHarnessTasks(loadEvalTasks(), 3);
    expect(selected.map((task) => task.kind)).toEqual(['factual', 'survey', 'challenge']);
    expect(HARNESS_CONCURRENCY).toBe(2);
  });
});

describe('quote judge parsing', () => {
  it('strips a code fence and counts an unparseable call as not judged', async () => {
    expect(parseSupports('```json\n{"supports": true}\n```')).toBe(true);
    const result = await judgeQuoteSupports(
      [{ sentence: 'The finding holds.', quote: 'the finding' }],
      async () => ({ content: 'not json', model: 'x', role: 'verifier', promptTokens: 0, completionTokens: 0, durationMs: 1, usedFallback: false, primaryModel: 'x' })
    );
    expect(result.notJudged).toBe(1);
    expect(result.score).toBeNull();
  });
});
