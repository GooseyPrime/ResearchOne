/**
 * Records what the quality judge's model actually answers for the five fixture
 * reports, so the acceptance test can replay those answers without a network.
 *
 * Run by hand, with an OpenRouter key in the environment, whenever the judge
 * prompt, the judge model or the fixtures change:
 *   npx tsx scripts/record-report-quality-replies.ts
 *
 * It goes through the real judge (`judgeReportQuality`) and only listens in on
 * the model's reply. Nothing is typed in by hand: a prompt that does not tell
 * the reports apart produces a recording that fails the test.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { callRoleModel } from '../src/services/openrouter/openrouterService';
import { judgeReportQuality } from '../src/services/eval/reportQualityJudge';
import { REPORT_QUALITY_PROMPT } from '../src/services/eval/reportQualityPrompt';
import { FIXTURE_DIR, VARIANT_NAMES, loadVariants } from '../src/__tests__/fixtures/report-quality/variants';

async function main(): Promise<void> {
  const variants = loadVariants();
  const replies: Record<string, { reportSha256: string; model: string; reply: string }> = {};
  for (const name of VARIANT_NAMES) {
    let heard: { model: string; reply: string } | null = null;
    const listening: typeof callRoleModel = async (options) => {
      const result = await callRoleModel(options);
      heard = { model: result.model, reply: result.content };
      return result;
    };
    const judgment = await judgeReportQuality(variants[name], listening);
    if (!judgment || !heard) throw new Error(`The judge gave no usable score for "${name}"`);
    replies[name] = { reportSha256: createHash('sha256').update(variants[name]).digest('hex'), ...(heard as { model: string; reply: string }) };
    console.log(`${name}: mean ${judgment.mean.toFixed(2)} ${JSON.stringify(judgment.subScores)}`);
  }
  const recording = {
    // Ties the recording to the prompt it was made with; the test checks it.
    promptSha256: createHash('sha256').update(REPORT_QUALITY_PROMPT).digest('hex'),
    replies,
  };
  writeFileSync(join(FIXTURE_DIR, 'recorded-replies.json'), `${JSON.stringify(recording, null, 2)}\n`);
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
);
