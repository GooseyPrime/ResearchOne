/**
 * The Challenge pass: what the challenge method found, written for a reader.
 *
 * A request examined by the challenge method (a verdict-type request) gets the
 * same plain report as every other request. What the challenge found is not
 * mixed into that report and is not laid out as an argument between two sides.
 * It is written once, here, in plain prose, as one section named "Challenge
 * pass". The reading page shows that section on its own tab, and an export of
 * the report leaves it out.
 *
 * This module never changes the report. A failure here is contained: the report
 * is saved without the section and the reason is logged with the run id.
 */
import { withLayer1Preamble } from '../../constants/prompts';
import { stripInternalLabelsFromReport, readerFacingLabelHits } from '../formatting/reportPresentation';
import { callRoleModel, type ModelCallResult } from '../openrouter/openrouterService';
import { removeBannedWording } from './reportGenerator';
import type { ResearchObjective } from './reasoningModelPolicy';

/** The public name of the challenge material. It is never shown under another name. */
export const CHALLENGE_PASS_TITLE = 'Challenge pass';

const NOTES_LIMIT = 12_000;
const REPORT_LIMIT = 24_000;

export const CHALLENGE_PASS_WRITER_PROMPT = withLayer1Preamble(`You write one short section of a research report, called the Challenge pass.
It tells the reader, in plain prose, how the findings of the report could be wrong.

You are given the finished report and a reviewer's notes that question it.

RULES:
- Write for a general reader, in neutral third-person prose, like a note at the end of a review article.
- Where the notes support it, cover: which findings rest on a single source, or on sources that trace back to one origin; what other explanation fits the same information; what the report could not check; and what new information would change a finding.
- Use only points that are in the notes or in the report. Do not add facts. Where information is missing, say that it is missing; never treat missing information as a sign of anything.
- Do not lay the section out as a trial or a debate. Do not write a ruling, and do not set out two opposing sides.
- Do not use the words claim, claims, skeptic, steelman, adversarial, red team, devil's advocate or verdict. Write "finding", "statement", "the report says", "the sources report".
- Do not name a research step, a reviewer, a grade, a tier or a passage label. Do not cite by number.
- No headings. Two to four short paragraphs, or a short paragraph followed by a short bullet list. 120 to 300 words.
- If the notes raise nothing that bears on the report's findings, write one sentence saying that the challenge pass found nothing that changes them.

Return the section text only.`);

/** Words the Challenge pass may not carry to a reader. What cannot be reworded is a reason not to show the section. */
const NOT_FOR_A_READER = /\b(?:claim(?:s|ed|ing)?|steel-?man\w*|skeptic\w*|sceptic\w*|devil[’']?s advocate|red[- ]team\w*|adversar(?:y|ies|ial)\b)/i;

/**
 * The writer's text as it may be saved: headings turned into plain lines (a
 * heading would start a new section of the report), citation numbers and
 * passage labels removed (nothing is saved behind them), labels and courtroom
 * words put into plain ones. Null when what is left still carries wording a
 * reader must not be shown, or nothing is left.
 */
export function cleanChallengePass(text: string): string | null {
  const flat = text
    .replace(/```[\s\S]*?```/g, '')
    .split('\n')
    .map((line) => {
      const heading = /^\s{0,3}#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
      if (!heading) return line;
      const words = heading[1].trim();
      // The section is already named; a heading that repeats the name is dropped.
      return /^challenge(?: pass)?$/i.test(words.replace(/[*_]/g, '')) ? '' : `**${words.replace(/\*\*/g, '')}**`;
    })
    .join('\n')
    .replace(/[ \t]*\[\s*P?\d+(?:\s*[,;]\s*P?\d+)*\s*\]/gi, '')
    .replace(/[ \t]*[[(]\s*chunks?\s+\d+(?:\s*(?:,|and|&)\s*\d+)*\s*[\])]/gi, '');
  const cleaned = removeBannedWording(stripInternalLabelsFromReport(flat))
    .replace(/[ \t]+([.,;:])/g, '$1')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (!cleaned) return null;
  if (NOT_FOR_A_READER.test(cleaned)) return null;
  if (readerFacingLabelHits(cleaned).length > 0) return null;
  return cleaned;
}

/** The report with the Challenge pass as its last section. */
export function appendChallengePass(markdown: string, prose: string): string {
  return `${markdown.trimEnd()}\n\n## ${CHALLENGE_PASS_TITLE}\n\n${prose.trim()}\n`;
}

export interface ChallengePassResult {
  /** The section text, or null when none could be written for a reader. */
  prose: string | null;
  /** Why there is no section. Null when there is one. */
  reason: 'no_notes' | 'writer_failed' | 'wording' | null;
  modelCalls: ModelCallResult[];
}

/**
 * Write the Challenge pass from the notes of the challenge stage. One model
 * call, by a role that has a second model on another provider behind it. Asked
 * once more when the first text cannot be shown; never throws.
 */
export async function writeChallengePass(args: {
  query: string;
  reportMarkdown: string;
  challengeNotes: string;
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  byokApiKeyOverride?: string;
}): Promise<ChallengePassResult> {
  const notes = args.challengeNotes.trim();
  if (!notes) return { prose: null, reason: 'no_notes', modelCalls: [] };
  const modelCalls: ModelCallResult[] = [];
  const ask = async (extra: string): Promise<string | null> => {
    const result = await callRoleModel({
      role: 'plain_language_synthesizer',
      engineVersion: args.engineVersion,
      researchObjective: args.researchObjective,
      allowFallbackByRole: args.allowFallbackByRole,
      byokApiKeyOverride: args.byokApiKeyOverride,
      // Written for the reader with the baseline handling. The challenge itself
      // ran earlier, as the challenge stage, and is not run again here.
      baselineLayer: true,
      isAdjudicative: false,
      messages: [
        { role: 'system', content: CHALLENGE_PASS_WRITER_PROMPT },
        {
          role: 'user',
          content: `Question the report answers:\n${args.query}\n\nThe report:\n${args.reportMarkdown.slice(0, REPORT_LIMIT)}\n\nThe reviewer's notes:\n${notes.slice(0, NOTES_LIMIT)}${extra}`,
        },
      ],
    });
    modelCalls.push(result);
    return cleanChallengePass(result.content);
  };
  try {
    const first = await ask('');
    if (first) return { prose: first, reason: null, modelCalls };
    const second = await ask('\n\nYour last answer could not be shown to a reader. Write it again in plain prose, following every rule above.');
    return second ? { prose: second, reason: null, modelCalls } : { prose: null, reason: 'wording', modelCalls };
  } catch {
    return { prose: null, reason: 'writer_failed', modelCalls };
  }
}
