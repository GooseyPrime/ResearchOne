import { describe, expect, it } from 'vitest';
import { judgeQuoteSupports, parseSupports } from '../services/eval/quoteSupportsJudge';
import { SignInRejectedError } from '../services/eval/runHarness';
import { assertSpendConfirmed, selectHarnessTasks, submitSelectedTasks, waitForRunInDatabase } from '../scripts/runEvalHarness';
import { loadEvalTasks } from '../services/eval/taskSet';

describe('harness command', () => {
  it('refuses to start without spend confirmation', () => {
    expect(() => assertSpendConfirmed(['node', 'runEvalHarness.ts'])).toThrow(/confirm-spend/);
  });

  it('selects one factual, one survey, and one challenge for the pilot', () => {
    const selected = selectHarnessTasks(loadEvalTasks(), 3);
    expect(selected.map((task) => task.kind)).toEqual(['factual', 'survey', 'challenge']);
  });

  it('submits every selected task before following any run, and prints each reference immediately', async () => {
    const tasks = selectHarnessTasks(loadEvalTasks(), 3);
    const events: string[] = [];
    await submitSelectedTasks({
      tasks,
      submit: async (task) => {
        events.push(`submit:${task.id}`);
        return { runId: `id-${task.id}` };
      },
      lookupReference: async (runId) => `R1-${runId}`,
      print: (line) => events.push(`print:${line}`),
    });
    expect(events.filter((event) => event.startsWith('submit:'))).toHaveLength(3);
    expect(events.indexOf('print:factual-crispr-fda reference=R1-id-factual-crispr-fda run=id-factual-crispr-fda')).toBeGreaterThan(
      events.indexOf('submit:factual-crispr-fda')
    );
    expect(events.indexOf('print:factual-crispr-fda reference=R1-id-factual-crispr-fda run=id-factual-crispr-fda')).toBeLessThan(
      events.indexOf('submit:survey-mrna')
    );
  });

  it('stops before a second submission when the sign-in is rejected', async () => {
    const tasks = selectHarnessTasks(loadEvalTasks(), 3);
    const submitted: string[] = [];
    await expect(
      submitSelectedTasks({
        tasks,
        submit: async (task) => {
          submitted.push(task.id);
          throw new SignInRejectedError();
        },
        lookupReference: async () => 'R1-unused',
        print: () => {},
      })
    ).rejects.toThrow('The sign-in was rejected or expired.');
    expect(submitted).toEqual([tasks[0].id]);
  });

  it('follows a run from the database and times out without using the sign-in', async () => {
    const reads: string[] = [];
    let clock = 0;
    await expect(
      waitForRunInDatabase({
        runId: 'run-1',
        readStatus: async (runId) => {
          reads.push(runId);
          return 'queued';
        },
        timeoutMs: 5,
        sleep: async () => {
          clock = 6;
        },
        now: () => clock,
      })
    ).rejects.toThrow('run run-1 timed out');
    expect(reads).toEqual(['run-1']);
    let status = 'running';
    await waitForRunInDatabase({
      runId: 'run-2',
      readStatus: async () => status,
      timeoutMs: 1000,
      sleep: async () => {
        status = 'completed';
      },
      now: () => 0,
    });
    expect(status).toBe('completed');
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
