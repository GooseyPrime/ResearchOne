/**
 * pairwise_vs_reference is measured only when it was judged (section 8). The
 * harness asks the fixed blind judge in both orders for factual and survey
 * tasks that have a reference file; otherwise the score is null and no model
 * is asked. An unreadable judgment is null, never a win or a loss.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { PAIRWISE_MODEL, judgePairwise, parsePairwiseVerdict, scorePairwiseForTask } from '../services/eval/pairwiseReference';
import { summarizeScores } from '../services/eval/taskSet';

type Call = Parameters<typeof judgePairwise>[2];

function judge(...answers: string[]): { call: NonNullable<Call>; seen: Array<{ user: string; model?: string }> } {
  const seen: Array<{ user: string; model?: string }> = [];
  const call = vi.fn(async (options: { messages: Array<{ role: string; content: string }>; runtimeOverrides?: { primary?: string } }) => {
    seen.push({ user: options.messages.find((m) => m.role === 'user')?.content ?? '', model: options.runtimeOverrides?.primary });
    return { content: answers.shift() ?? '' };
  });
  return { call: call as unknown as NonNullable<Call>, seen };
}

function referenceDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'refs-'));
  for (const [name, text] of Object.entries(files)) {
    mkdirSync(join(dir, name, '..'), { recursive: true });
    writeFileSync(join(dir, name), text);
  }
  return dir;
}

describe('the pairwise judge', () => {
  it('asks both blind orders with the fixed model; a win or tie counts, a loss does not', async () => {
    const { call, seen } = judge('{"better":"A"}', '{"better":"A"}');
    expect(await judgePairwise('OURS', 'THEIRS', call)).toEqual([1, 0]);
    expect(seen[0].user.indexOf('OURS')).toBeLessThan(seen[0].user.indexOf('THEIRS'));
    expect(seen[1].user.indexOf('THEIRS')).toBeLessThan(seen[1].user.indexOf('OURS'));
    expect(seen.every((entry) => entry.model === PAIRWISE_MODEL)).toBe(true);
    expect(await judgePairwise('OURS', 'THEIRS', judge('{"better":"tie"}', '{"better":"B"}').call)).toEqual([1, 1]);
  });

  it('an unreadable judgment gives no score', async () => {
    expect(parsePairwiseVerdict('The first one')).toBeNull();
    expect(await judgePairwise('OURS', 'THEIRS', judge('not json', '{"better":"A"}').call)).toBeNull();
  });
});

describe('pairwise scoring in the harness', () => {
  it('is null with no reference directory or no reference file, and asks no model', async () => {
    const { call, seen } = judge();
    expect((await scorePairwiseForTask({ id: 't1', kind: 'factual' }, 'OURS', undefined, call)).pairwise_vs_reference).toBeNull();
    expect((await scorePairwiseForTask({ id: 't1', kind: 'factual' }, 'OURS', referenceDir({}), call)).pairwise_vs_reference).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('is not scored for challenge tasks', async () => {
    const dir = referenceDir({ 'chatgpt/c1.md': 'ref' });
    const { call, seen } = judge();
    expect((await scorePairwiseForTask({ id: 'c1', kind: 'challenge' }, 'OURS', dir, call)).pairwise_vs_reference).toBeNull();
    expect(seen).toHaveLength(0);
  });

  it('scores the lower of the two competitors when both references exist', async () => {
    const dir = referenceDir({ 'chatgpt/f1.md': 'chatgpt ref', 'perplexity/f1.md': 'perplexity ref' });
    const { call } = judge('{"better":"A"}', '{"better":"B"}', '{"better":"B"}', '{"better":"A"}');
    expect(await scorePairwiseForTask({ id: 'f1', kind: 'factual' }, 'OURS', dir, call)).toEqual({
      pairwise_vs_reference: 0,
      pairwise_chatgpt: 1,
      pairwise_perplexity: 0,
    });
  });

  it('runHarness records it, and the summary leaves it null when nothing was judged', () => {
    const source = readFileSync(join(__dirname, '../services/eval/runHarness.ts'), 'utf8');
    expect(source).toContain('await scorePairwiseForTask(task, stored.reportMarkdown)');
    const scores = { pairwise_vs_reference: null } as unknown as Parameters<typeof summarizeScores>[0][number]['scores'];
    expect(summarizeScores([{ taskId: 't', scores }]).pairwise_vs_reference).toBeNull();
  });
});
