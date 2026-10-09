import { describe, expect, it, vi } from 'vitest';
import { flagForRun, flagValueForRun, UnknownFlagError } from '../services/eval/flagOverride';
import { fixtureFiles, runHarness, type EvalTransport } from '../services/eval/runHarness';
import { summarizeScores } from '../services/eval/taskSet';
import { QUOTE_SUPPORTS_FALLBACK, QUOTE_SUPPORTS_MODEL, QUOTE_SUPPORTS_PROMPT } from '../services/eval/quoteSupportsPrompt';
import type { EvalTask } from '../services/eval/taskSet';

vi.mock('../db/pool', () => ({
  query: vi.fn().mockResolvedValue([]),
}));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn().mockResolvedValue({ content: '{"supports": true}' }),
}));

describe('flag lookup', () => {
  it('uses the config default, then the recorded override', async () => {
    expect(flagForRun('AUTHORITY_TIERS_ENABLED', null)).toBe(false);
    expect(flagForRun('AUTHORITY_TIERS_ENABLED', { AUTHORITY_TIERS_ENABLED: true })).toBe(true);
    const { query } = await import('../db/pool');
    vi.mocked(query).mockResolvedValueOnce([{ flags: { AUTHORITY_TIERS_ENABLED: true } }]);
    await expect(flagValueForRun('run-1', 'AUTHORITY_TIERS_ENABLED')).resolves.toBe(true);
  });

  it.each(['BASELINE_LAYER_ENABLED', 'CITATION_LOCK_ENABLED', 'READER_VIEW_ENABLED'])('does not know %s: the name is no longer a flag, whatever is recorded under it', async (name) => {
    expect(() => flagForRun(name, null)).toThrow(UnknownFlagError);
    expect(() => flagForRun(name, { [name]: true })).toThrow(`Unknown flag: ${name}`);
    const { query } = await import('../db/pool');
    vi.mocked(query).mockResolvedValueOnce([{ flags: { [name]: true } }]);
    await expect(flagValueForRun('run-1', name)).rejects.toThrow(UnknownFlagError);
  });
});

describe('harness runner', () => {
  it('submits a challenge task with its three fixture files and stores the summary scores', async () => {
    const task: EvalTask = {
      id: 'challenge-rail-budget',
      kind: 'challenge',
      intent: 'investigation',
      prompt: 'Investigate the overrun.',
      anomalyPhrase: 'never invoiced',
      fixtureDocuments: [
        { name: 'challenge-rail-budget-side-a.txt', role: 'side_a', text: 'change orders' },
        { name: 'challenge-rail-budget-side-b.txt', role: 'side_b', text: 'steel prices' },
        { name: 'challenge-rail-budget-anomaly.txt', role: 'anomaly', text: 'never invoiced' },
      ],
    };
    const started: EvalTask[] = [];
    const attached: string[][] = [];
    let passedOverrides: Record<string, boolean> | null = null;
    const transport: EvalTransport = {
      async start(next, files, overrides) {
        started.push(next);
        attached.push(files.map((file) => file.name));
        passedOverrides = overrides;
        return { runId: 'run-1' };
      },
      async wait() {},
      async load() {
        return {
          reportMarkdown: 'The accounts disagree [E1]. never invoiced',
          citations: [{ alias: 'E1', chunkQuote: 'change orders', chunkText: 'change orders', citationText: null, claimText: 'The accounts disagree', chunkId: 'chunk-1' }],
          contradictionLinks: [
            { documentA: 'challenge-rail-budget-side-a.txt', documentB: 'challenge-rail-budget-side-b.txt' },
          ],
          startedAt: '2026-10-01T00:00:00.000Z',
          completedAt: '2026-10-01T00:01:00.000Z',
          tokens: 1200,
          recordedCostUsd: 0.42,
        };
      },
    };
    const rows = await runHarness(transport, [task], { DOI_RESOLVE_ENABLED: false });
    expect(started).toHaveLength(1);
    expect(passedOverrides).toEqual({ DOI_RESOLVE_ENABLED: false });
    expect(attached[0]).toEqual(fixtureFiles(task).map((file) => file.name));
    expect(rows[0].scores.contradiction_retention).toBe(1);
    expect(rows[0].scores.time_to_report).toBe(60);
    expect(rows[0].scores.tokens).toBe(1200);
    const summary = summarizeScores(rows);
    expect(summary.time_to_report_p50).toBe(60);
    expect(summary.time_to_report_p90).toBe(60);
    expect(summary.tokens_p50).toBe(1200);
    expect(summary.quote_supports).toBe(1);
    expect(summary.doi_resolution).toBeNull();
  });
});

describe('quote supports judge', () => {
  it('calls the committed prompt with the primary model and the other-provider fallback', async () => {
    const { judgeQuoteSupports } = await import('../services/eval/quoteSupportsJudge');
    const call = vi.fn().mockResolvedValue({ content: '{"supports": true}' });
    const score = await judgeQuoteSupports(
      [
        { sentence: 'The audit blames change orders.', quote: 'change orders' },
        { sentence: '', quote: 'unused' },
      ],
      call
    );
    expect(score.score).toBe(1);
    expect(score.skipped).toBe(1);
    expect(score.notJudged).toBe(0);
    expect(call).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([{ role: 'system', content: QUOTE_SUPPORTS_PROMPT }]),
        runtimeOverrides: { primary: QUOTE_SUPPORTS_MODEL, fallback: QUOTE_SUPPORTS_FALLBACK },
      })
    );
  });
});
