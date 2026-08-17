/**
 * Targeted section repair (WO-AC R3).
 *
 * The repair loop used to hand the coherence refiner the entire report and ask
 * it to rewrite everything. On run `e5aac059` one pass ran 6m51s emitting
 * 10,265 completion tokens to add missing sections, still failed, and
 * verification consumed 39% of a 36-minute run. Rewriting a report that is
 * already mostly correct is both slow and risky — passing sections can regress.
 *
 * Repair is now scoped, cheapest sufficient mode first:
 *   - APPEND_MISSING when sections are absent: write only the missing material.
 *     Absence wins over content findings, because a section that was never
 *     written cannot be fixed by rewriting the ones that were.
 *   - REWRITE_SECTIONS when content findings name specific sections: reissue
 *     only those blocks and splice them back by heading.
 *   - REWRITE_WHOLE only when a content failure names no section, or names so
 *     many that a scoped pass costs more than one full pass.
 *
 * Run `c50162a9` spent 11m44s on two whole-report rewrites for a defect that
 * was two absent sections, because the mode was chosen by substring-matching
 * the MERGED instruction text — and the verifier names an `unsupported_claims`
 * criterion on nearly every run. Classification is now per instruction.
 */

export type RepairMode = 'append_missing' | 'rewrite_sections' | 'rewrite_whole';

export interface RepairPlan {
  mode: RepairMode;
  /** Human-readable headings the repair must produce (append mode). */
  missingSections: string[];
  /** Existing headings this repair will replace (rewrite_sections mode). */
  targetedSections: string[];
  userPrompt: string;
  progressMessage: string;
  detail: string;
}

/**
 * Phrases that indicate content EXISTS but is wrong, not that it is absent.
 *
 * These are matched PER INSTRUCTION, never against the merged instruction text.
 * On run `c50162a9` the merged text was scanned for these signals, and because
 * the verifier emits a `unsupported_claims` criterion on virtually every run,
 * both repair attempts became whole-report rewrites (7m13s + 4m31s) even though
 * the actual defect was two absent sections. One matching word anywhere in a
 * twenty-item report must not escalate the entire repair.
 */
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

/** True when one instruction is about existing content rather than absence. */
function isContentInstruction(instruction: string): boolean {
  const text = (instruction ?? '').toLowerCase();
  return REWRITE_SIGNALS.some((signal) => text.includes(signal));
}

interface ReportSectionBlock {
  /** Heading text with markdown decoration stripped. */
  heading: string;
  /** Full block including its heading line. */
  text: string;
  startLine: number;
  endLine: number;
}

/**
 * Split a report into top-level (`##`) blocks.
 *
 * `#` is the report title and is never a repair target; `###` and deeper are
 * subsections and travel with their parent.
 */
export function splitTopLevelSections(markdown: string): ReportSectionBlock[] {
  const lines = (markdown ?? '').split('\n');
  const blocks: ReportSectionBlock[] = [];
  let current: { heading: string; startLine: number; body: string[] } | null = null;
  let inFence = false;

  lines.forEach((line, index) => {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const match = inFence ? null : line.match(/^##\s+(.+?)\s*$/);
    if (match) {
      if (current) {
        blocks.push({
          heading: current.heading,
          text: current.body.join('\n').trimEnd(),
          startLine: current.startLine,
          endLine: index - 1,
        });
      }
      current = {
        heading: (match[1] ?? '').replace(/[*_`#]/g, '').trim(),
        startLine: index,
        body: [line],
      };
      return;
    }
    if (current) current.body.push(line);
  });

  if (current) {
    const open = current as { heading: string; startLine: number; body: string[] };
    blocks.push({
      heading: open.heading,
      text: open.body.join('\n').trimEnd(),
      startLine: open.startLine,
      endLine: lines.length - 1,
    });
  }
  return blocks;
}

/**
 * Headings that a set of content findings actually names.
 *
 * A finding like "Opportunity 7 cites a price with no source" localises the
 * defect; rewriting the other nineteen items to fix it is waste that also risks
 * regressing sections which already passed.
 */
export function sectionsNamedInFindings(
  findings: readonly string[],
  sections: readonly ReportSectionBlock[]
): string[] {
  const named: string[] = [];
  const seen = new Set<string>();
  const haystack = findings.join('\n').toLowerCase();
  if (!haystack.trim()) return named;

  for (const section of sections) {
    const heading = section.heading.toLowerCase();
    // Very short headings ("1.", "Q3") match too much text to be evidence that
    // this particular section is the one at fault.
    if (heading.length < 5) continue;
    if (seen.has(heading)) continue;
    if (haystack.includes(heading)) {
      seen.add(heading);
      named.push(section.heading);
      continue;
    }
    // Numbered item headings are commonly referenced by ordinal alone
    // ("item 7", "opportunity 7") rather than by their full title.
    const ordinal = heading.match(/^(\d{1,3})\s*[.)\]:-]/)?.[1];
    if (ordinal && new RegExp(`\\b(?:item|section|opportunity|option|vertical|#)\\s*${ordinal}\\b`).test(haystack)) {
      seen.add(heading);
      named.push(section.heading);
    }
  }
  return named;
}

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
  // Partition per instruction. A report can be simultaneously missing sections
  // AND carry a weak claim somewhere; those need different repairs, and the
  // presence of the second must not discard the first.
  const contentInstructions = args.revisionInstructions.filter(isContentInstruction);
  const absenceInstructions = args.revisionInstructions.filter((line) => !isContentInstruction(line));

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
  const absenceBlock = (absenceInstructions.length > 0 ? absenceInstructions : args.revisionInstructions)
    .map((line) => `- ${line}`)
    .join('\n');

  // Absence dominates: sections that were never written cannot be fixed by
  // rewriting the ones that were. Write them first; a later attempt handles
  // any content findings that survive re-verification.
  if (missingSections.length > 0) {
    return {
      mode: 'append_missing',
      missingSections,
      targetedSections: [],
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
        absenceBlock,
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

  // Content findings that name specific sections are repaired in place. This is
  // the common case for a large report: one or two items carry a weak claim and
  // the other eighteen are fine.
  const sections = splitTopLevelSections(args.markdown);
  const targetedSections = sectionsNamedInFindings(
    contentInstructions.length > 0 ? contentInstructions : args.revisionInstructions,
    sections
  );

  // Rewriting nearly everything section-by-section costs more than one whole
  // pass and loses cross-section coherence, so hand those back to the full path.
  const SCOPED_REWRITE_MAX_SHARE = 0.5;
  const scopedIsWorthwhile =
    targetedSections.length > 0 &&
    sections.length > 1 &&
    targetedSections.length <= Math.ceil(sections.length * SCOPED_REWRITE_MAX_SHARE);

  if (scopedIsWorthwhile) {
    const targetedKeys = new Set(targetedSections.map((heading) => heading.toLowerCase()));
    const excerpt = sections
      .filter((section) => targetedKeys.has(section.heading.toLowerCase()))
      .map((section) => section.text)
      .join('\n\n');

    return {
      mode: 'rewrite_sections',
      missingSections: [],
      targetedSections,
      progressMessage: `Repairing ${targetedSections.length} of ${sections.length} sections (scoped).`,
      detail: targetedSections.join(' | '),
      userPrompt: [
        'The sections below are the ONLY parts of the report that need revision.',
        'Return corrected versions of exactly these sections and nothing else.',
        '',
        'Rules:',
        '- Reproduce each "## " heading character-for-character. Headings are how',
        '  your output is spliced back into the report; a changed heading is dropped.',
        '- Return the sections in the order given, complete, with no preamble,',
        '  no commentary about the revision, and no other sections.',
        '- Fix only what the requirements below call out. Preserve everything else',
        '  in these sections, including their structure and subsection headings.',
        '',
        'Requirements to satisfy:',
        (contentInstructions.length > 0 ? contentInstructions : args.revisionInstructions)
          .map((line) => `- ${line}`)
          .join('\n'),
        '',
        'SECTIONS TO REVISE:',
        excerpt,
      ].join('\n'),
    };
  }

  return {
    mode: 'rewrite_whole',
    missingSections,
    targetedSections: [],
    progressMessage: 'Repairing report content (full pass).',
    detail: args.revisionInstructions.slice(0, 3).join(' | '),
    userPrompt: `Revise the report to satisfy these contract and verification requirements:\n${instructionBlock}\n\nREPORT:\n${args.markdown}`,
  };
}

/**
 * Fold the repair output back into the report.
 *
 * - `append_missing` splices new sections onto the end.
 * - `rewrite_sections` replaces matching `##` blocks in place, keeping every
 *   untouched section byte-identical.
 * - `rewrite_whole` replaces everything.
 *
 * An empty or whitespace-only repair response leaves the original untouched
 * rather than blanking a report that was mostly fine.
 */
export function applyTargetedRepair(
  originalMarkdown: string,
  repairContent: string,
  plan: RepairPlan
): string {
  const addition = (repairContent ?? '').trim();
  if (!addition) return originalMarkdown;
  if (plan.mode === 'rewrite_whole') return addition;

  if (plan.mode === 'rewrite_sections') {
    const replacements = new Map<string, string>();
    for (const block of splitTopLevelSections(addition)) {
      replacements.set(block.heading.toLowerCase(), block.text);
    }
    // The model returned nothing we can splice (no headings, or all renamed).
    // Keeping the original beats appending an orphaned fragment.
    if (replacements.size === 0) return originalMarkdown;

    const originalBlocks = splitTopLevelSections(originalMarkdown);
    if (originalBlocks.length === 0) return originalMarkdown;

    const lines = originalMarkdown.split('\n');
    const preamble = lines.slice(0, originalBlocks[0]!.startLine).join('\n').trimEnd();
    const rebuilt = originalBlocks.map((block) => {
      const replacement = replacements.get(block.heading.toLowerCase());
      return replacement ?? block.text;
    });
    return [preamble, ...rebuilt].filter((part) => part.length > 0).join('\n\n');
  }

  return `${originalMarkdown.trimEnd()}\n\n${addition}\n`;
}
