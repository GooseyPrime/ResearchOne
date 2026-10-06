/**
 * The four spoiled copies the quality judge must score below the clean report
 * (upgrade plan, B3). Each is made from the clean report by one change, so the
 * only difference the judge can be reacting to is the fault itself.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const VARIANT_NAMES = ['clean', 'grade-labels', 'chunk-citations', 'repeated-fact', 'no-citations'] as const;
export type VariantName = (typeof VARIANT_NAMES)[number];

const REPEATED = 'Casgevy was approved by the FDA on 8 December 2023 [1].';

/** Body and reference list, split at the last "## References" heading. */
function parts(report: string): { body: string; references: string } {
  const at = report.lastIndexOf('\n## References');
  return at === -1 ? { body: report, references: '' } : { body: report.slice(0, at), references: report.slice(at) };
}

/** Apply a change to every paragraph of prose: not headings, not blank lines. */
function eachParagraph(body: string, change: (paragraph: string, index: number) => string): string {
  let index = 0;
  return body
    .split('\n')
    .map((line) => (line.trim() && !line.startsWith('#') ? change(line, index++) : line))
    .join('\n');
}

export function buildVariants(clean: string): Record<VariantName, string> {
  const { body, references } = parts(clean);
  const labels = ['[Tier 1 evidence] ', 'Grade A: ', '[Tier 2 evidence] ', 'Grade B: '];
  return {
    clean,
    // Internal grading printed into the text a reader sees.
    'grade-labels':
      eachParagraph(body, (paragraph, index) => `${labels[index % labels.length]}${paragraph} (Verifier status: PASS; confidence 0.92)`) + references,
    // Citations left in the pipeline's internal form.
    'chunk-citations': body.replace(/\[(\d+)\]/g, '[Chunk $1]') + references,
    // One fact said again in every section.
    'repeated-fact': eachParagraph(body, (paragraph, index) => (index === 0 ? paragraph : `${paragraph} ${REPEATED}`)) + references,
    // No citations and nothing to check them against.
    'no-citations': `${body.replace(/ ?\[\d+\]/g, '').trimEnd()}\n`,
  };
}

export const FIXTURE_DIR = __dirname;

export function loadVariants(): Record<VariantName, string> {
  return buildVariants(readFileSync(join(FIXTURE_DIR, 'clean.md'), 'utf8').replace(/\r\n/g, '\n'));
}
