/**
 * Targeted section repair (WO-AC R3).
 *
 * The repair loop used to hand the coherence refiner the entire report and ask
 * it to rewrite everything. On run `e5aac059` one pass ran 6m51s emitting
 * 10,265 completion tokens to add missing sections, still failed, and
 * verification consumed 39% of a 36-minute run. Rewriting a report that is
 * already mostly correct is both slow and risky — passing sections can regress.
 *
 * Repair is now scoped:
 *   - ADDITIVE when the auditor reports missing sections: write only the
 *     missing material and append it.
 *   - REWRITE only when the failure is about existing content (unsupported
 *     claims, drift), where a whole-report pass is genuinely warranted.
 */

export type RepairMode = 'append_missing' | 'rewrite_whole';

export interface RepairPlan {
  mode: RepairMode;
  /** Human-readable headings the repair must produce (append mode). */
  missingSections: string[];
  userPrompt: string;
  progressMessage: string;
  detail: string;
}

/** Phrases that indicate content EXISTS but is wrong, not that it is absent. */
const REWRITE_SIGNALS = [
  'unsupported',
  'fabricat',
  'intent drift',
  'contradict',
  'inconsistent',
  'incorrect',
  'misleading',
  'remove',
];

/**
 * Pull candidate section headings out of auditor requirements.
 *
 * Auditor output is prose like "Final Winner market selection" or "30-Day
 * Validation Plan with measurable go/no-go criteria". We want the leading
 * noun-phrase, which is nearly always the heading the report should carry.
 */
export function extractMissingSectionTitles(requirements: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of requirements) {
    const text = (raw ?? '').trim();
    if (!text) continue;
    // Skip machine codes like `exact_count_mismatch:8/20`.
    if (/^[a-z0-9_]+:/i.test(text) && !text.includes(' ')) continue;
    if (/^required_fields_missing/i.test(text)) continue;

    // Take the phrase before a connective, and cap length.
    const phrase = text
      .split(/\s+(?:with|containing|comparing|defining|ranked|for the|that|which)\b/i)[0]
      ?.replace(/^(?:provide|create|generate|deliver|list|include|develop|outline|complete)\s+/i, '')
      ?.replace(/^(?:a|an|the)\s+/i, '')
      ?.replace(/[.:;]$/, '')
      ?.trim();
    if (!phrase || phrase.length < 4 || phrase.length > 90) continue;

    const key = phrase.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(phrase.charAt(0).toUpperCase() + phrase.slice(1));
  }
  return out;
}

/** Headings already present in the report, lowercased. */
function existingHeadings(markdown: string): Set<string> {
  const set = new Set<string>();
  for (const match of (markdown ?? '').matchAll(/^#{1,6}\s+(.+?)\s*$/gm)) {
    const heading = match[1]?.replace(/[*_`#]/g, '').trim().toLowerCase();
    if (heading) set.add(heading);
  }
  return set;
}

/** Trailing slice of the report, for continuity context without resending it all. */
function tailContext(markdown: string, maxChars: number): string {
  const text = markdown ?? '';
  if (text.length <= maxChars) return text;
  return `...[earlier sections omitted]...\n${text.slice(-maxChars)}`;
}

const MAX_TAIL_CHARS = 6_000;

export function planTargetedRepair(args: {
  markdown: string;
  revisionInstructions: readonly string[];
  missingRequirements: readonly string[];
}): RepairPlan {
  const instructionText = args.revisionInstructions.join(' ').toLowerCase();
  const wantsRewrite = REWRITE_SIGNALS.some((signal) => instructionText.includes(signal));

  const candidateTitles = extractMissingSectionTitles(args.missingRequirements);
  const present = existingHeadings(args.markdown);
  const missingSections = candidateTitles.filter((title) => {
    const key = title.toLowerCase();
    for (const heading of present) {
      if (heading.includes(key) || key.includes(heading)) return false;
    }
    return true;
  });

  const instructionBlock = args.revisionInstructions.map((line) => `- ${line}`).join('\n');

  if (!wantsRewrite && missingSections.length > 0) {
    return {
      mode: 'append_missing',
      missingSections,
      progressMessage: `Repairing ${missingSections.length} missing section${missingSections.length === 1 ? '' : 's'} (targeted).`,
      detail: missingSections.join(' | '),
      userPrompt: [
        'The report below is INCOMPLETE. Sections listed as missing were never written.',
        '',
        'Write ONLY the missing sections. Do NOT rewrite, restate, summarise, or',
        'reproduce any existing content — everything you return is APPENDED to the',
        'existing report exactly as written.',
        '',
        'Missing sections to write now, in this order, each as a markdown heading:',
        missingSections.map((title) => `## ${title}`).join('\n'),
        '',
        'Requirements to satisfy:',
        instructionBlock,
        '',
        'Rules:',
        '- Start your output directly with the first missing heading.',
        '- Produce complete, substantive content for every listed section.',
        '- Do not add a preamble, a conclusion, or commentary about the repair.',
        '- Do not repeat headings that already exist in the report.',
        '',
        'End of the existing report, for continuity only (do not repeat it):',
        tailContext(args.markdown, MAX_TAIL_CHARS),
      ].join('\n'),
    };
  }

  return {
    mode: 'rewrite_whole',
    missingSections,
    progressMessage: 'Repairing report content (full pass).',
    detail: args.revisionInstructions.slice(0, 3).join(' | '),
    userPrompt: `Revise the report to satisfy these contract and verification requirements:\n${instructionBlock}\n\nREPORT:\n${args.markdown}`,
  };
}

/**
 * Fold the repair output back into the report.
 *
 * Append mode splices new sections onto the end; rewrite mode replaces. An
 * empty or whitespace-only repair response leaves the original untouched rather
 * than blanking a report that was mostly fine.
 */
export function applyTargetedRepair(
  originalMarkdown: string,
  repairContent: string,
  plan: RepairPlan
): string {
  const addition = (repairContent ?? '').trim();
  if (!addition) return originalMarkdown;
  if (plan.mode === 'rewrite_whole') return addition;
  return `${originalMarkdown.trimEnd()}\n\n${addition}\n`;
}
