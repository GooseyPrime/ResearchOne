import { describe, expect, it, vi } from 'vitest';
import { judgeQuoteSupports, parseSupports, selectQuotePairs } from '../services/eval/quoteSupportsJudge';
import { SignInRejectedError, STORED_CITATION_SQL } from '../services/eval/runHarness';
import { assertSpendConfirmed, followSubmittedRuns, parseScoreRunIds, PILOT_STARTING_POINT_RUNS, progressLine, selectHarnessTasks, shouldScoreStoredRun, submitSelectedTasks, waitForRunInDatabase } from '../scripts/runEvalHarness';
import { pairwiseScore } from '../services/eval/pairwiseReference';
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
          return { status: 'queued', reason: null };
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
      readStatus: async () => ({ status, reason: null }),
      timeoutMs: 1000,
      sleep: async () => {
        status = 'completed';
      },
      now: () => 0,
    });
    expect(status).toBe('completed');
  });

  it('approves a paused plan once and then waits until the run completes', async () => {
    let status = 'plan_pending_confirmation';
    let approvals = 0;
    const outcome = await waitForRunInDatabase({
      runId: 'run-3',
      readStatus: async () => ({ status, reason: null }),
      approvePlan: async () => {
        approvals += 1;
        status = 'running';
      },
      timeoutMs: 1000,
      sleep: async () => {
        if (approvals > 0) status = 'completed';
      },
      now: () => 0,
    });
    expect(approvals).toBe(1);
    expect(outcome).toEqual({ status: 'completed', reason: null });
  });

  it('ends the wait when a run is aborted and keeps the reason', async () => {
    const outcome = await waitForRunInDatabase({
      runId: 'run-4',
      readStatus: async () => ({ status: 'aborted', reason: 'retry budget exhausted' }),
      timeoutMs: 1000,
      sleep: async () => {},
      now: () => 0,
    });
    expect(outcome).toEqual({ status: 'aborted', reason: 'retry budget exhausted' });
  });

  it('approves a later run as soon as it reaches the gate, timing out from its own submission', async () => {
    const approvals: string[] = [];
    const statuses: Record<string, string> = { first: 'running', second: 'plan_pending_confirmation' };
    const outcomes = await followSubmittedRuns(
      [
        { task: { id: 'first' } as never, runId: 'first', reference: 'R1-first', submittedAt: 0 },
        { task: { id: 'second' } as never, runId: 'second', reference: 'R1-second', submittedAt: 0 },
      ],
      {
        readStatus: async (runId) => ({ status: statuses[runId], reason: null }),
        approvePlan: async (runId) => {
          approvals.push(runId);
          statuses[runId] = 'running';
        },
        timeoutMs: 10,
        sleep: async () => {
          if (approvals.includes('second')) statuses.first = 'completed';
          statuses.second = 'completed';
        },
        now: () => 0,
      }
    );
    expect(approvals).toEqual(['second']);
    expect(outcomes.map((row) => row.status).sort()).toEqual(['completed', 'completed']);
  });

  it('scores the other run when one times out, and prints each outcome as soon as it is known', async () => {
    const lines: string[] = [];
    let clock = 0;
    const outcomes = await followSubmittedRuns(
      [
        { task: { id: 'late' } as never, runId: 'late', reference: 'R1-late', submittedAt: 0 },
        { task: { id: 'done' } as never, runId: 'done', reference: 'R1-done', submittedAt: 0 },
      ],
      {
        readStatus: async (runId) => ({ status: runId === 'done' ? 'completed' : 'running', reason: null }),
        timeoutMs: 5,
        sleep: async () => {
          clock = 6;
        },
        now: () => clock,
        print: (line) => lines.push(line),
      }
    );
    expect(outcomes.find((row) => row.runId === 'done')?.status).toBe('completed');
    expect(outcomes.find((row) => row.runId === 'late')?.status).toBe('timed_out');
    expect(lines).toContain(progressLine('R1-done', 'completed', null));
  });

  it('scores a degraded report and skips a run with no report', () => {
    expect(shouldScoreStoredRun({ hasReport: true })).toBe(true);
    expect(shouldScoreStoredRun({ hasReport: false })).toBe(false);
    expect(parseScoreRunIds(['--score-run', PILOT_STARTING_POINT_RUNS[0], '--score-run', PILOT_STARTING_POINT_RUNS[1]])).toEqual(
      PILOT_STARTING_POINT_RUNS.slice(0, 2)
    );
  });

  it('uses the lower competitor score and leaves a missing reference null', () => {
    expect(pairwiseScore({ chatgpt: [0.4, 0.6], perplexity: [0.8, 0.8] })).toEqual({
      chatgpt: 0.5,
      perplexity: 0.8,
      pairwise_vs_reference: 0.5,
    });
    expect(pairwiseScore({ chatgpt: null, perplexity: [0.7, 0.9] }).chatgpt).toBeNull();
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

  it('counts pairs dropped by the cap as skipped', () => {
    const pairs = Array.from({ length: 30 }, (_, index) => ({ sentence: `claim ${index}`, quote: `quote ${index}` }));
    const selected = selectQuotePairs(pairs);
    expect(selected.selected).toHaveLength(25);
    expect(selected.skipped).toBe(5);
    expect(selected.selected.length + selected.skipped).toBe(pairs.length);
  });

  it('judges a stored citation with no sentence against its linked claim and skips a citation with none', async () => {
    const call = vi.fn().mockResolvedValue({
      content: '{"supports": true}',
      model: 'x',
      role: 'verifier',
      promptTokens: 1,
      completionTokens: 1,
      durationMs: 1,
      usedFallback: false,
      primaryModel: 'x',
    });
    const result = await judgeQuoteSupports(
      [
        { sentence: 'The FDA authorized Casgevy.', quote: 'FDA approved Casgevy' },
        { sentence: '', quote: 'a quote with no claim' },
      ],
      call
    );
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ content: expect.stringContaining('The FDA authorized Casgevy.') }),
        ]),
      })
    );
    expect(result.skipped).toBe(1);
    expect(result.judged).toBe(1);
    expect(STORED_CITATION_SQL).toContain('cl.claim_text AS "claimText"');
    expect(STORED_CITATION_SQL).toContain('ORDER BY s.section_order NULLS LAST, rc.citation_order NULLS LAST, rc.id');
  });
});
