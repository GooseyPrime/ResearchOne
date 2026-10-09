/**
 * Old report text, as a customer is shown it outside the report page (RJ-018).
 *
 * Reports written before the plain layout printed a grade together with where
 * it came from after a sentence: "(established_fact, Chunk 17)",
 * "(strong_evidence, Chunks 2, 12, 15)", "(inference, Challenger Findings)",
 * "(speculation, Critical Notes)", "(preserved contradiction, Reasoning
 * Output)". That text is still stored, and it is quoted in places that are not
 * the report: a dossier card, a request that was started from a report.
 *
 * `stripReportLabels` removes exactly those label shapes and nothing else. An
 * ordinary parenthesis ("(opened in 1932)", "(see Table 2)") is kept. The
 * server's clean-up (`backend/.../reportPresentation.ts`) removes the same
 * shapes from report text it sends; the two are held together by one list of
 * cases, `backend/src/__tests__/fixtures/reportLabelCases.json`.
 */

/** A grade that opens a label which also says where the finding came from. */
const GRADE_WITH_ORIGIN = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation|preserved[_ ]contradiction|contradiction|unresolved)';
/** A grade that is a label standing alone in brackets. */
const GRADE_ALONE = '(?:established[_ ]fact|strong[_ ]evidence|testimony|inference|speculation|preserved[_ ]contradiction)';
const PASSAGE_NUMBERS = 'chunks?\\s+\\d+(?:\\s*(?:,|;|&|and)\\s*(?:chunks?\\s+)?\\d+)*';
/** The system's own working notes, as old reports named them. */
const WORKING_NOTE =
  '(?:challenger?|critical|reasoning|reasoner|retriever|retrieval|planner|verifier|synthesi[sz]er|synthesis|quantitative|discovery|auditor)\\s+(?:findings|notes?|outputs?|analysis|summary|pass)';
const ORIGIN = `(?:${PASSAGE_NUMBERS}|${WORKING_NOTE})`;
const ORIGIN_LIST = `${ORIGIN}(?:\\s*[,;]\\s*${ORIGIN})*`;

const inBrackets = (inner: string): string => `\\s?(?:\\(\\s*${inner}\\s*\\)|\\[\\s*${inner}\\s*\\])`;

const LABELS: readonly RegExp[] = [
  // "(established_fact, Chunk 17)", "[Strong_Evidence - Chunks 2, 12, 15]", "(inference, Challenger Findings)".
  new RegExp(inBrackets(`${GRADE_WITH_ORIGIN}\\s*[,;:|\\u2013\\u2014-]\\s*${ORIGIN_LIST}`), 'gi'),
  // "(Challenger Findings)", "(Chunk 17)", "[Chunks 2, 12]".
  new RegExp(inBrackets(ORIGIN_LIST), 'gi'),
  // "(strong_evidence)", "[Inference]".
  new RegExp(inBrackets(GRADE_ALONE), 'gi'),
  // The snake-case grades are never ordinary words: "STRONG_EVIDENCE:", "established_fact".
  /\b(?:established_fact|strong_evidence|preserved_contradiction)\b:?[ \t]*/gi,
];

/**
 * Section names of the removed layout written inside a sentence, in the
 * capitals that layout gave them, and the words a reader is shown instead. The
 * one-word names ("Unresolved") are ordinary words and are left alone here; as
 * headings they are mapped by the reading page.
 */
const OLDER_SECTION_NAMES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bRecommended Next Queries\b/g, 'Further questions'],
  [/\bContested Zones?\b/g, 'Where sources disagree'],
  [/\bContradiction Analysis\b/g, 'Where sources disagree'],
  [/\bEvidence Ledger\b/g, 'What the sources show'],
  [/\bPrimary Evidence\b/g, 'What the sources show'],
  [/\bFalsification Criteria\b/g, 'What would change these findings'],
];

const REMOVED = '';

/** Old report text without its grade, passage and working-note labels. Everything else is returned as written. */
export function stripReportLabels(text: string | null | undefined): string {
  if (typeof text !== 'string' || text.length === 0) return '';
  let out = OLDER_SECTION_NAMES.reduce((held, [was, now]) => held.replace(was, now), text);
  for (const label of LABELS) out = out.replace(label, REMOVED);
  return (
    out
      // A removal right before punctuation leaves no space: "2023 (x)." -> "2023."
      .replace(/[ \t]*+[ \t]*(?=[.,;:!?)\]])/g, '')
      // A removal between words leaves one space.
      .replace(/(?<=\S)[ \t]*+[ \t]*(?=\S)/g, ' ')
      // A removal at the start or end of a line leaves nothing.
      .replace(/[ \t]*+[ \t]*/g, '')
  );
}

/** Whether any of the label shapes is in the text. For tests and for the guard on what a card shows. */
export function hasReportLabels(text: string): boolean {
  return LABELS.some((label) => new RegExp(label.source, label.flags.replace('g', '')).test(text));
}
