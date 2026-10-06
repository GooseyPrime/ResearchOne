/**
 * Upgrade plan B3: the quality judge must tell a clean report from the same
 * report with one fault. The model's answers were recorded from the real judge
 * model (scripts/record-report-quality-replies.ts) and are replayed here
 * through the real judge call path, so no score is typed in by hand.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { judgeReportQuality, type QualityJudgment } from '../services/eval/reportQualityJudge';
import { REPORT_QUALITY_FALLBACK, REPORT_QUALITY_MODEL, REPORT_QUALITY_PROMPT, type QualityPoint } from '../services/eval/reportQualityPrompt';
import { FIXTURE_DIR, VARIANT_NAMES, loadVariants, type VariantName } from './fixtures/report-quality/variants';

interface Recording {
  promptSha256: string;
  replies: Record<VariantName, { model: string; reply: string }>;
}

const recording = JSON.parse(readFileSync(join(FIXTURE_DIR, 'recorded-replies.json'), 'utf8')) as Recording;
const variants = loadVariants();

/** Stands in for the network only: answers with what the model said for this exact report. */
const replay = (async (options: { messages: Array<{ role: string; content: string }>; runtimeOverrides?: unknown }) => {
  expect(options.messages[0]).toEqual({ role: 'system', content: REPORT_QUALITY_PROMPT });
  expect(options.runtimeOverrides).toEqual({ primary: REPORT_QUALITY_MODEL, fallback: REPORT_QUALITY_FALLBACK });
  const name = VARIANT_NAMES.find((candidate) => variants[candidate] === options.messages[1].content);
  if (!name) throw new Error('The judge was sent a report that was never recorded');
  return { content: recording.replies[name].reply, model: recording.replies[name].model };
}) as unknown as Parameters<typeof judgeReportQuality>[1];

async function judged(name: VariantName): Promise<QualityJudgment> {
  const judgment = await judgeReportQuality(variants[name], replay);
  if (!judgment) throw new Error(`No usable score recorded for "${name}"`);
  return judgment;
}

/** The sub-score each fault is meant to pull down. */
const FAULT_POINT: Record<Exclude<VariantName, 'clean'>, QualityPoint> = {
  'grade-labels': 'plain_neutral_prose',
  'chunk-citations': 'citation_clarity',
  'repeated-fact': 'appropriate_length',
  'no-citations': 'citation_clarity',
};
const SPOILED = Object.keys(FAULT_POINT) as Array<Exclude<VariantName, 'clean'>>;

describe('report quality judge (B3)', () => {
  it('was recorded with the prompt and the model the judge uses now', () => {
    expect(recording.promptSha256).toBe(createHash('sha256').update(REPORT_QUALITY_PROMPT).digest('hex'));
    for (const name of VARIANT_NAMES) {
      expect([REPORT_QUALITY_MODEL, REPORT_QUALITY_FALLBACK]).toContain(recording.replies[name].model);
    }
  });

  it('spoils each copy with its own fault and nothing else', () => {
    const { clean } = variants;
    expect(clean).toMatch(/\[1\]/);
    expect(clean).not.toMatch(/Tier \d|Grade [AB]:|Verifier status|\[Chunk/);
    expect(variants['grade-labels']).toMatch(/\[Tier 1 evidence\].*Verifier status: PASS/s);
    expect(variants['chunk-citations'].replace(/\[Chunk (\d+)\]/g, '[$1]')).toBe(clean);
    expect(variants['repeated-fact'].split('approved by the FDA on 8 December 2023').length).toBeGreaterThanOrEqual(4);
    expect(variants['no-citations']).not.toMatch(/\[\d+\]|## References/);
    expect(new Set(Object.values(variants)).size).toBe(VARIANT_NAMES.length);
  });

  it.each(SPOILED)('scores the clean report above the "%s" copy', async (name) => {
    const clean = await judged('clean');
    const spoiled = await judged(name);
    expect(spoiled.mean).toBeLessThan(clean.mean);
    expect(spoiled.subScores[FAULT_POINT[name]]).toBeLessThan(clean.subScores[FAULT_POINT[name]]);
  });
});
