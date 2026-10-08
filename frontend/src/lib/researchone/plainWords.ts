/**
 * Plain words for what the pipeline calls things (RJ-013).
 *
 * The pipeline names its steps and roles for itself: stage ids, substep codes
 * ("reasoner_started"), model-role keys and a few nicknames. Those names stay
 * in the code, the database and the prompts. Nothing a person reads shows one:
 * every place that prints a role, a step or a progress message goes through
 * this file, so a run stored before the wording changed reads the same as a
 * new one.
 */
import { READER_STAGE_WORDS } from './stageLabels';

/** Model-role and cost-phase keys, as a person reads them. Keys are lower case. */
const ROLE_WORDS: Record<string, string> = {
  planner: 'Research planning',
  retriever: 'Source reading',
  source_class_classifier: 'Source sorting',
  reasoner: 'Evidence analysis',
  steelman: 'Strongest-form restatement',
  skeptic: 'Challenge pass',
  internal_challenger: 'Draft review',
  synthesizer: 'Report writing',
  verifier: 'Report checking',
  plain_language_synthesizer: 'Plain-language writing',
  outline_architect: 'Report outline',
  section_drafter: 'Section writing',
  coherence_refiner: 'Final read-through',
  revision_intake: 'Revision request reading',
  report_locator: 'Finding affected sections',
  change_planner: 'Change planning',
  section_rewriter: 'Section rewriting',
  citation_integrity_checker: 'Citation checking',
  final_revision_verifier: 'Revised report checking',
  contract_auditor: 'Completeness check',
};

/** Progress messages stored by earlier versions, with the words they have now. */
const EARLIER_MESSAGES: Array<[RegExp, string]> = [
  [/^steel-?man pass:.*$/i, 'Restating each finding in its strongest form before checking it...'],
  [/^worker picked up the run; preparing planner\.*$/i, 'Starting the run and preparing the research plan...'],
];

/** A nickname for a role or a pass, and the plain words that take its place. */
const NICKNAMES: Array<[RegExp, string]> = [
  [/\bdevil'?s[- ]advocate(?: (?:review|pass))?/gi, 'challenge pass'],
  [/\bred[- ]?team(?:ing|ed|s)?(?: (?:review|pass))?/gi, 'challenge pass'],
  [/\bsteel[- ]?man(?:ning|ned|s)?(?: pass)?/gi, 'strongest-form restatement'],
  [/\bstraw[- ]?m[ae]n(?:ning)?/gi, 'weaker version'],
  [/\bs[kc]eptic(?:al|ism|s)?(?: pass)?/gi, 'challenge pass'],
  [/\bcontrarians?(?: (?:review|pass))?/gi, 'challenge pass'],
  [/\badversarial(?: (?:review|pass|twin|challenge))?/gi, 'challenge pass'],
  [/\badversar(?:y|ies)/gi, 'challenge pass'],
  [/\bgadfl(?:y|ies)(?: pass)?/gi, 'challenge pass'],
];

/** An internal code: lower-case words joined by underscores ("steelman_started"). */
const STEP_CODE = /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g;

const sentenceCase = (text: string): string => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/**
 * Text that came from the pipeline (a progress message, an error line, a
 * detail), with nicknames replaced and step codes taken out. Text that has
 * neither comes back unchanged.
 */
export function plainProgressText(text: string | null | undefined): string {
  const original = (text ?? '').trim();
  if (!original) return '';
  for (const [earlier, now] of EARLIER_MESSAGES) if (earlier.test(original)) return now;
  let plain = original;
  // "(steelman_started)" after a message says nothing to a reader: drop it whole.
  plain = plain.replace(/\s*[([]\s*[a-z][a-z0-9]*(?:_[a-z0-9]+)+\s*[)\]]/g, '');
  for (const [nickname, words] of NICKNAMES) plain = plain.replace(nickname, words);
  // A code inside a sentence is read as its words.
  plain = plain.replace(STEP_CODE, (code) => code.replace(/_/g, ' '));
  plain = plain.replace(/\b(challenge pass)(?: \1)+/gi, '$1').replace(/[ \t]{2,}/g, ' ').trim();
  return plain === original ? original : sentenceCase(plain);
}

/**
 * A role, cost phase, stage or checkpoint id as a label. A known role or stage
 * has its own words; any other id is read as its words, never shown as written.
 */
export function plainLabel(id: string | null | undefined): string {
  const key = (id ?? '').trim();
  if (!key) return '';
  const lower = key.toLowerCase();
  if (ROLE_WORDS[lower]) return ROLE_WORDS[lower];
  if (READER_STAGE_WORDS[lower]) return READER_STAGE_WORDS[lower];
  // "skeptic_output" is the saved result of a known step.
  const result = /^(.+)_(output|result)$/.exec(lower);
  if (result && (ROLE_WORDS[result[1]] || READER_STAGE_WORDS[result[1]])) return `${ROLE_WORDS[result[1]] ?? READER_STAGE_WORDS[result[1]]}: saved result`;
  return sentenceCase(plainProgressText(lower.replace(/[_-]+/g, ' ')));
}

/** Every role key with its words, for the test that none shows through raw. */
export const PLAIN_ROLE_WORDS: Readonly<Record<string, string>> = ROLE_WORDS;
