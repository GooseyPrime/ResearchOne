import { CLAIM_WORD, SPOKEN_ROLE_NAME, mapCitationProse, mapLinkLabels, mapOutsideQuotes, stripInternalLabelsFromReport } from '../formatting/reportPresentation';
import { logger } from '../../utils/logger';
import { callRoleModel, getSystemPrompt } from '../openrouter/openrouterService';
import { baselineLayerEnabled } from '../../config';
import { LOCK_INSTRUCTION, finalizeLockedCitations, formatLockedContext, keepRewritesThatPreserveMarkers, markersPreserved, passagesForSection, stripUnknownMarkers, unknownMarkers, type FinalizedCitations, type LockedPassage } from './citationLock';
import type { ReferenceStyle } from '../formatting/referenceList';
import { capBullets, firstSentences, isSizedReaderSection, isBulletList, readerSectionBudgets, readerSectionRule, trimToWords, wordCount, draftedSections, readerTitle, removeRepeatedSentences, repeatedSentences, stripGradeLines, trimSummaryAtSentence, presentationFailures, buildReferences, buildAbout, acceptSubjectHeading, distinctSourceCount, renumberCitations, formatReadDate, parseRewrittenSections, sectionsToMarkdown, type UsedSource } from './baselineReport';
import type { ResearchObjective } from './reasoningModelPolicy';
import {
  CLAIM_CLASS_SOURCING_BURDEN,
  getIntentOutputTemplate,
  INTENT_OUTPUT_TEMPLATES,
} from '../formatting/templates/intentOutputTemplates';
import {
  appendContractRequiredSections,
  deriveContractWordTarget,
  deriveItemLabel,
  expandSectionPlanForContract,
  findRepeatedArtifact,
  type ContractArtifact,
  type SectionPlanEntry,
} from './contractOutline';
import {
  GENERATED_TITLE_MAX_LENGTH,
  stripHeadingDecoration,
  trimTitle,
} from '../research/titleShaping';

export interface ReportSectionDraft {
  title: string;
  key: string;
  content: string;
}

/**
 * Marker the drafter uses to name a concrete item on an item section.
 *
 * Headings are composed by CODE, never authored by a model. The drafter's only
 * influence on a heading is this one line, which it may omit — the ordinal and
 * the report type's label are enough to produce a valid heading without it.
 *
 * Why a line marker rather than JSON: section bodies contain markdown tables,
 * pipes, and code fences. Wrapping those in JSON adds an escaping failure mode
 * on every section for no benefit, and a malformed envelope would cost the
 * whole section rather than just its name.
 */
const ITEM_NAME_MARKER = /^[ \t]*(?:[*_`]{0,2})ITEM[ _-]?NAME(?:[*_`]{0,2})[ \t]*[:：][ \t]*(.+?)[ \t]*$/im;

/** Longest item name we will put in a heading. */
const MAX_ITEM_NAME_CHARS = 70;

/**
 * Words that can precede an ordinal and still be numbering rather than a name.
 *
 * An enumerated list, not `[A-Za-z]{1,20}`. The permissive version matched any
 * short word before the number, so `ISO 27001: Security controls` became
 * `Security controls`, `Type 2: Diabetes care` became `Diabetes care`, and
 * `GPT 4: Enterprise automation` lost its subject — the heading corrupted by
 * the fix for corrupted headings (Codex P2, PR #229).
 *
 * Add a word here only when it is a numbering label in its own right AND is
 * plausible output from a drafter. `section` and `part` are deliberately
 * absent: the drafter is prompted with the report type's item label
 * (Opportunity, Finding, Claim, Option, Step…), so it has little reason to
 * write "Section 4: X", while `Section 508: Accessibility` and
 * `Part 121: Operations` are real names this would have eaten. When a label is
 * ambiguous, not stripping costs a duplicated number; stripping costs the
 * subject of the heading.
 */
const ORDINAL_LABELS = [
  'item',
  'items',
  'no',
  'number',
  'step',
  'phase',
  'opportunity',
  'option',
  'finding',
  'claim',
  'entry',
  'event',
  'factor',
  'recommendation',
  'argument',
  'direction',
  'study',
] as const;

/**
 * A number the model put at the front of a name that is about to be numbered.
 *
 * Covers `16.`, `16)`, `16.1 `, `16 -`, `#16 -`, `Item 16:`, `Opportunity 3 —`.
 *
 * A bare number followed only by a space is stripped ONLY when it is
 * multi-level (`16.1 Name`). `2024 outlook` keeps its year: a leading number
 * with no punctuation after it is usually part of the name, and deleting it
 * would be a worse defect than the one this fixes.
 */
const LEADING_ORDINAL = new RegExp(
  `^\\s*(?:#+\\s*)?(?:(?:${ORDINAL_LABELS.join('|')})\\s+)?` +
    `(?:\\d+(?:\\.\\d+)+\\s+|\\d+(?:\\.\\d+)*\\s*[.):\u2013\u2014-]\\s+)`,
  'i'
);

/**
 * Strip a numbering prefix the drafter added to an item name.
 *
 * Item headings are numbered by CODE from the plan's ordinal. When the drafter
 * also numbers its `ITEM NAME` line — which it does, because the section it was
 * handed is numbered in the plan it can see — the two numbers are concatenated
 * and the reader gets `## 16. 16. Something`. The operator saw "16.16" and
 * "18.18" in a real report.
 *
 * The pipeline owns the ordinal, so the model's copy of it is discarded rather
 * than trusted.
 */
export function stripLeadingOrdinal(name: string): string {
  let out = (name ?? '').trim();
  // Twice at most: "Section 16. 16. Foo" is one model doing it in two places.
  for (let i = 0; i < 2; i += 1) {
    const next = out.replace(LEADING_ORDINAL, '').trim();
    if (next === out || !next) break;
    out = next;
  }
  return out;
}

/** Compare two heading-ish strings ignoring case, punctuation and numbering. */
function headingKey(value: string): string {
  return stripLeadingOrdinal(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Remove a Markdown heading the drafter wrote at the top of a section body,
 * but ONLY when it is a second copy of the heading the assembler will add.
 *
 * Every section's heading is prepended by the assembler (`## ${title}`), so a
 * body that opens with its own copy renders two — and if the model numbered
 * its copy, the reader sees the ordinal twice.
 *
 * The first version of this removed any leading heading of any level. That
 * deleted a section which legitimately opens with `### Risks` or
 * `#### Implementation details`, keeping the text and losing its label: a
 * structural loss in exchange for a cosmetic fix (Codex P2, PR #229). It now
 * removes a heading only when it says the same thing as the composed title,
 * once numbering and punctuation are set aside.
 */
export function stripLeadingSectionHeading(body: string, composedTitle?: string): string {
  const text = (body ?? '').replace(/^\s+/, '');
  const match = text.match(/^(#{1,6})[ \t]+([^\n]*)\n+/);
  if (!match) return text.trim();

  const headingText = match[2] ?? '';
  const rest = text.slice(match[0].length).trim();
  // A section whose entire content was one heading keeps it — better a
  // duplicated heading than an empty section.
  if (!rest) return text.trim();

  if (composedTitle === undefined) {
    // No title to compare against: only a top-level `#`/`##` is plausibly the
    // section's own title being repeated. A `###` or deeper is sub-structure.
    return (match[1] ?? '').length <= 2 ? rest : text.trim();
  }

  const heading = headingKey(headingText);
  const title = headingKey(composedTitle);
  if (!heading || !title) return text.trim();
  return heading === title ? rest : text.trim();
}

/**
 * Pull the drafter's item name off a section body, returning the name and the
 * body with the marker line removed.
 *
 * The marker is an instruction to the pipeline, not report content, so it must
 * never survive into the deliverable.
 */
export function extractItemName(body: string): { itemName: string | null; content: string } {
  const text = body ?? '';
  const match = text.match(ITEM_NAME_MARKER);
  if (!match) return { itemName: null, content: text };

  const raw = (match[1] ?? '')
    .replace(/[*_`#]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,]+$/, '')
    .trim();

  const content = text.replace(match[0], '').replace(/^\s*\n/, '').trimStart();
  const named = stripLeadingOrdinal(raw);
  if (!named || named.length > MAX_ITEM_NAME_CHARS) return { itemName: null, content };
  return { itemName: named, content };
}

/**
 * Compose an item section heading from data the pipeline owns.
 *
 * `ordinal` comes from the plan, `label` from the report type, `itemName` from
 * the drafter. No part of this is parsed back out of model prose, which is what
 * makes the contract auditor's match exact instead of heuristic.
 */
export function composeItemHeading(args: {
  ordinal: number;
  label: string;
  itemName?: string | null;
  lastOrdinal?: number;
}): string {
  const range =
    typeof args.lastOrdinal === 'number' && args.lastOrdinal > args.ordinal
      ? `${args.ordinal}–${args.lastOrdinal}`
      : `${args.ordinal}`;
  const name = args.itemName?.trim();
  if (name) return `${range}. ${name}`;
  const label = args.lastOrdinal && args.lastOrdinal > args.ordinal ? `${args.label}s` : args.label;
  return `${range}. ${label}`;
}

/**
 * Delimiters used to hand sections to the coherence refiner and route its
 * output back.
 *
 * The refiner still sees the WHOLE report — cross-section coherence needs the
 * big picture, and per-section refinement is too granular to fix flow between
 * sections. What changes is that it no longer AUTHORS the structure: it fills
 * in labelled slots, and the code reassembles.
 *
 * Delimiters rather than JSON because section bodies contain markdown tables,
 * pipes, and fenced code. JSON-encoding those adds an escaping failure mode to
 * every run, and one bad escape would cost the entire report; a malformed
 * delimiter costs one section, which falls back to its drafted text.
 */
const SECTION_BLOCK_CLOSE = '<<<END SECTION>>>';
const SECTION_BLOCK_OPEN_EXAMPLE = '<<<SECTION key="the-exact-key-given-below">>>';
const SECTION_BLOCK_PATTERN =
  /<<<\s*SECTION\s+key\s*=\s*"([^"]+)"\s*>>>\s*\n?([\s\S]*?)(?:<<<\s*END\s+SECTION\s*>>>|$)/gi;

/** Render drafted sections as labelled blocks for the refiner. */
export function formatSectionsForRefiner(
  sections: readonly ReportSectionDraft[]
): string[] {
  return sections.map(
    (section) =>
      `<<<SECTION key="${section.key}">>>\n${section.content}\n${SECTION_BLOCK_CLOSE}`
  );
}

/**
 * Parse the refiner's labelled blocks back into a key -> body map.
 *
 * Blocks with an unknown key, or with an empty body, are omitted so the caller
 * falls back to the drafted text rather than blanking a section.
 *
 * `titlesByKey` lets a refined block be stripped of a repeated section heading
 * on the same terms as a drafted one: only when the heading says what the
 * assembler is about to say. Without it, `### Risks` at the top of a refined
 * block is indistinguishable from a repeated title, and guessing loses the
 * reader a real subsection.
 */
export function parseRefinedSections(
  response: string,
  titlesByKey?: ReadonlyMap<string, string>
): Map<string, string> {
  const out = new Map<string, string>();
  const text = response ?? '';
  SECTION_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_BLOCK_PATTERN.exec(text)) !== null) {
    const key = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (!key || !body) continue;
    // A refiner that emits a copy of the section's heading would otherwise
    // leave it stranded under the real one, which the assembler prepends.
    const withoutHeading = stripLeadingSectionHeading(body, titlesByKey?.get(key));
    if (!withoutHeading) continue;
    out.set(key, withoutHeading);
  }
  return out;
}

/**
 * Table formatting rules for the section drafter (WO-AC R5).
 *
 * Run `e5aac059` emitted a 20-row portfolio table in which row 2 was truncated
 * mid-row and then repeated after a blank line. That split one table into two
 * fragments: the reader saw broken output and the deterministic counter read 8
 * rows instead of 20, failing the contract on a table that was substantively
 * complete.
 */
const TABLE_SECTION_PATTERN = /table|matrix|portfolio|compar|grid|scorecard|dimensions|summary of/i;

/**
 * Whether a given section is plausibly going to emit a table.
 *
 * With R1 outline expansion a run can make ~40 drafter calls; injecting table
 * rules into all of them wastes prompt tokens and constrains prose sections
 * that will never contain a table (Copilot review, PR #205). Rules are included
 * when the section itself looks tabular, or when the run's contract asks for a
 * tabular artifact — the latter matters because a section titled
 * "Opportunities 1–5" may legitimately carry the portfolio table.
 */
export function sectionExpectsTable(args: {
  title: string;
  key: string;
  contractWantsTable: boolean;
}): boolean {
  if (TABLE_SECTION_PATTERN.test(args.title) || TABLE_SECTION_PATTERN.test(args.key)) return true;
  return args.contractWantsTable;
}

/**
 * The ONE section that carries the contract's exact table.
 *
 * `sectionExpectsTable` returns true for every section once the contract asks
 * for a table anywhere, which is right for generic formatting hygiene but wrong
 * for the exact schema: handing "emit exactly 20 rows with these 18 columns" to
 * all ~24 drafters tells Executive Summary, every individual item, and Caveats
 * to each reproduce the whole portfolio table (Codex review, PR #209).
 *
 * Preference order:
 *   1. A non-item section whose title or key reads as tabular — including the
 *      slot `appendContractRequiredSections` created for a named table.
 *   2. The first non-item section after the item sections, i.e. where a summary
 *      table naturally belongs once the items have been enumerated.
 *   3. Nothing. Emitting the directive nowhere is recoverable — the table
 *      auditor flags the gap and repair adds it — whereas emitting it
 *      everywhere corrupts the deliverable.
 */
export function resolveTableSectionKey(
  plan: readonly { title: string; key: string; itemOrdinal?: number }[],
  contractWantsTable: boolean
): string | null {
  if (!contractWantsTable) return null;
  const nonItem = plan.filter((entry) => typeof entry.itemOrdinal !== 'number');
  if (nonItem.length === 0) return null;

  const tabular = nonItem.find(
    (entry) => TABLE_SECTION_PATTERN.test(entry.title) || TABLE_SECTION_PATTERN.test(entry.key)
  );
  if (tabular) return tabular.key;

  const lastItemIndex = plan.reduce(
    (last, entry, index) => (typeof entry.itemOrdinal === 'number' ? index : last),
    -1
  );
  if (lastItemIndex === -1) return null;
  return plan.slice(lastItemIndex + 1).find((entry) => typeof entry.itemOrdinal !== 'number')?.key ?? null;
}

/** True when any requested artifact or format implies a tabular deliverable. */
export function contractRequestsTable(
  artifacts: readonly ContractArtifact[] | undefined,
  requestedFormats: readonly string[] | undefined
): boolean {
  const artifactHit = (artifacts ?? []).some((artifact) =>
    // `description` only: production briefs carry no `type` (Rule 42 R42-11).
    TABLE_SECTION_PATTERN.test(artifact.description ?? '')
  );
  if (artifactHit) return true;
  return (requestedFormats ?? []).some((format) => TABLE_SECTION_PATTERN.test(format));
}

export const TABLE_FORMATTING_RULES = `
Markdown table rules (MANDATORY when you emit a table):
- Use GitHub-Flavored Markdown pipe syntax: a header row, then a separator row
  of dashes, then one row per line. NEVER separate columns with middle dots (·),
  bullets, tabs, slashes, or any other character — even when the request or the
  requested column list is written that way. A run of "A · B · C" lines is not a
  table and renders as one unreadable paragraph.
- Never emit a continuation placeholder in place of rows. Bracketed notes such as
  "[rows 6-20 follow the same structure]" or "[remaining items omitted]" are draft
  artifacts, not deliverable content. Emit every row you were asked for, or state
  plainly which rows you could not produce and why.
- Keep the table to at most 8 columns. If more fields are required, split into two
  tables joined by the identifier column and label each one.
- One row per line. A row must NEVER be split across lines or interrupted by a
  blank line — a blank line ends the table and everything after it is lost.
- Never repeat a row.
- Every row must have exactly the same number of cells as the header row.
- Escape any literal pipe inside a cell as \\| so it is not read as a column break.
- Keep cell text short; put long prose in the narrative, not in a cell.
- Do not wrap the table in a code fence: fenced tables render as code, not tables.`;

/**
 * Give the drafter the exact header row instead of a column count.
 *
 * Run `c50162a9` requested 18 per-item fields. The drafter was told "every row
 * must have exactly the same number of cells as the header row" — but it chose
 * the header itself, and 19 of 20 rows then disagreed with it. A rule about
 * consistency cannot be followed when the thing to be consistent with is not
 * supplied. Handing over the literal header and delimiter rows makes the
 * requirement mechanical.
 *
 * Returns an empty string when the contract names no per-item fields; there is
 * nothing to pin down and inventing a schema would be worse than silence.
 */
export function buildTableHeaderDirective(args: {
  fields: readonly string[];
  itemLabel: string;
  rowCount?: number;
}): string {
  const fields = args.fields.map((field) => field.trim()).filter(Boolean);
  if (fields.length === 0) return '';

  const titleCase = (field: string) =>
    field.replace(/[_-]+/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase());
  const columns = ['#', args.itemLabel, ...fields.map(titleCase)];
  const header = `| ${columns.join(' | ')} |`;
  const delimiter = `| ${columns.map(() => '---').join(' | ')} |`;
  const rowRule =
    typeof args.rowCount === 'number' && args.rowCount > 0
      ? `Emit exactly ${args.rowCount} data rows, numbered 1..${args.rowCount}, one per ${args.itemLabel.toLowerCase()}.`
      : `Emit one data row per ${args.itemLabel.toLowerCase()}.`;

  return `
REQUIRED TABLE HEADER (copy verbatim, do not add, drop, reorder, or rename columns):
${header}
${delimiter}

${rowRule}
Every data row must contain exactly ${columns.length} cells. Leave a cell empty
rather than omitting it — an omitted cell shifts every column after it and the
row is read as belonging to a different schema.`;
}

/**
 * The runtime plan is the same shape the contract expander produces, including
 * the item ordinals it attaches. Redeclaring it locally let the two drift, and
 * the ordinals the assembler needs were invisible to it.
 */
type RuntimeSectionPlanEntry = SectionPlanEntry;

/**
 * Whether a section is about one subject, not the whole report. Only two kinds
 * are: a subject heading the outline step named ("topic_…"), and one item of a
 * repeated deliverable. Every other section of every template (summary, direct
 * answer, sources, findings, limits, recommendation, conclusion and the rest)
 * speaks for the whole report. Under the citation lock a subject section is
 * narrowed to the passages closest to it when they do not all fit; a
 * whole-report section sees every passage that fits. Naming the two narrow
 * kinds, not listing the broad ones, means a new template key is never
 * narrowed by oversight.
 */
export function isSubjectSection(section: { key: string; itemOrdinal?: number }): boolean {
  return section.key.startsWith('topic_') || typeof section.itemOrdinal === 'number';
}

/**
 * How many item sections may be drafted at once.
 *
 * Synthesis was 13m54s of a 44-minute run, drafted strictly one section at a
 * time. Item sections are independent by construction — each has its own key,
 * its own drafter call, and its own repair path — so the serialisation bought
 * nothing.
 *
 * Kept modest and overridable: every slot is a concurrent model call, and the
 * ceiling that matters is the provider's rate limit, not this process.
 */
export const SECTION_DRAFT_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.SECTION_DRAFT_CONCURRENCY ?? '', 10) || 4
);

/** Below this, an item's body is too short to be useful; send its title alone. */
const MIN_ITEM_DIGEST_CHARS = 240;

/**
 * Share of the rolling summary reserved for the framing written before the
 * items, so the item digest has a budget it can actually plan against.
 *
 * Declared as a function of the summary cap at the call site rather than a
 * module constant, because `MAX_ROLLING_SUMMARY_CHARS` is defined further down.
 */
const framingContextChars = (max: number) => Math.floor(max * 0.25);

export interface PartitionedSectionPlan {
  /** Framing written before the items, e.g. an overview. */
  leading: RuntimeSectionPlanEntry[];
  /** The independent per-item sections, safe to draft concurrently. */
  items: RuntimeSectionPlanEntry[];
  /** Framing that summarises, ranks, or concludes over the items. */
  trailing: RuntimeSectionPlanEntry[];
}

/**
 * Split a plan into the parts that must be ordered and the part that need not be.
 *
 * Expansion always replaces the list section in place, so item sections are
 * contiguous. If that ever stops holding — a future plan interleaving framing
 * between items — the run falls back to fully sequential drafting rather than
 * silently reordering the report.
 */
export function partitionSectionPlan(
  plan: readonly RuntimeSectionPlanEntry[]
): PartitionedSectionPlan {
  const isItem = (entry: RuntimeSectionPlanEntry) => typeof entry.itemOrdinal === 'number';
  const first = plan.findIndex(isItem);
  if (first === -1) return { leading: [...plan], items: [], trailing: [] };

  let last = first;
  for (let i = plan.length - 1; i >= first; i -= 1) {
    if (isItem(plan[i]!)) {
      last = i;
      break;
    }
  }

  const span = plan.slice(first, last + 1);
  if (!span.every(isItem)) {
    // Non-item content sits between items; ordering may be meaningful.
    return { leading: [...plan], items: [], trailing: [] };
  }

  return {
    leading: plan.slice(0, first),
    items: [...span],
    trailing: plan.slice(last + 1),
  };
}

/**
 * Run `fn` over `items` with at most `limit` in flight, preserving input order
 * in the result.
 *
 * On failure every in-flight call is allowed to settle before the first error
 * is rethrown. Rejecting immediately would leave sibling model calls running
 * with nothing to receive them — billed, unobservable, and still writing to the
 * run's telemetry after the run has failed.
 */
export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  // Collected rather than kept in a single mutable slot: the reported failure is
  // the lowest INDEX, not the first worker to reject. With a pool those differ,
  // and the earliest section is the meaningful one to surface.
  const failures: Array<{ index: number; error: unknown }> = [];

  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      // Stop CLAIMING work once the run is doomed. Previously a rejection only
      // ended the rejecting worker while its siblings kept pulling indices, so
      // a failure on section 2 of 20 still billed most of the remaining model
      // calls before the error surfaced (Codex + Copilot review, PR #210).
      if (failures.length > 0) return;
      const index = next;
      next += 1;
      if (index >= items.length) return;
      try {
        results[index] = await fn(items[index]!, index);
      } catch (error) {
        failures.push({ index, error });
        return;
      }
    }
  });

  // Workers absorb their own rejections, so this resolves once every call that
  // had already started has settled — which is the documented behaviour.
  await Promise.all(workers);
  if (failures.length > 0) {
    const earliest = failures.reduce((a, b) => (b.index < a.index ? b : a));
    throw earliest.error;
  }
  return results;
}

/**
 * Render a bounded digest that contains EVERY item.
 *
 * The previous approach appended each item to the rolling summary and let the
 * summary's tail-slice enforce the cap. That silently dropped the head: 40
 * drafts at the 240-character floor need 9,600 characters against a 6,000
 * budget, so a ranking section received only the last handful of items and was
 * asked to rank all of them (Codex review, PR #210).
 *
 * Budget is divided across items up front. When there is not enough room for
 * meaningful bodies, every item still contributes its title — an incomplete
 * list is a worse failure than a shallow one, because the drafter cannot tell
 * that anything is missing.
 */
export function buildItemDigest(
  items: readonly { title: string; content: string }[],
  maxChars: number
): string {
  if (items.length === 0 || maxChars <= 0) return '';

  const SEPARATOR = '\n\n';
  const separatorCost = SEPARATOR.length * Math.max(0, items.length - 1);
  const perItem = Math.floor((maxChars - separatorCost) / items.length);

  const parts = items.map((item) => {
    const label = `[${item.title}]`;
    if (perItem <= label.length + 1) {
      // Title-only, truncated if even that does not fit. Presence beats detail.
      return label.slice(0, Math.max(1, perItem));
    }
    const room = perItem - label.length - 1;
    if (room < MIN_ITEM_DIGEST_CHARS) return label;
    return `${label}\n${item.content.slice(0, room).trimEnd()}`;
  });

  return parts.join(SEPARATOR);
}

const ADJUDICATIVE_SECTION_PLAN: Array<{ title: string; key: string; weight: number }> = [
  { title: 'Executive Summary', key: 'executive_summary', weight: 0.6 },
  { title: 'Research Question and Scope', key: 'research_question_scope', weight: 0.5 },
  { title: 'Evidence Ledger', key: 'evidence_ledger', weight: 1.4 },
  { title: 'Reasoning and Analysis', key: 'reasoning_analysis', weight: 1.6 },
  { title: 'Contradiction Analysis', key: 'contradiction_analysis', weight: 1.0 },
  { title: 'Challenges and Alternative Explanations', key: 'challenges_alternatives', weight: 1.0 },
  { title: 'Synthesis and Conclusions', key: 'synthesis_conclusions', weight: 1.2 },
  { title: 'Falsification Criteria', key: 'falsification_criteria', weight: 0.6 },
  { title: 'Unresolved Questions', key: 'unresolved_questions', weight: 0.5 },
  { title: 'Recommended Next Queries', key: 'recommended_next_queries', weight: 0.5 },
];

/** Descriptive / discovery section plan — used for non-adjudicative intents.
 *  Omits `falsification_criteria` and `contradiction_analysis` (which are
 *  only meaningful for causal-test / adjudicative queries) and adds
 *  deliverable-focused sections instead. */
export const DESCRIPTIVE_SECTION_PLAN: Array<{ title: string; key: string; weight: number }> = [
  { title: 'Executive Summary', key: 'executive_summary', weight: 0.6 },
  { title: 'Research Question and Scope', key: 'research_question_scope', weight: 0.5 },
  // Title, not key. "Evidence Ledger" is adjudication vocabulary, and a heading
  // the drafter is handed is a frame the drafter writes in — it seeded
  // "evidence" language through reports that were never adjudicating anything.
  // The key stays `evidence_ledger` because reportRevisionService anchors
  // insertion order on it.
  { title: 'Key Findings and Sources', key: 'evidence_ledger', weight: 1.4 },
  { title: 'Reasoning and Analysis', key: 'reasoning_analysis', weight: 1.6 },
  { title: 'Synthesis and Conclusions', key: 'synthesis_conclusions', weight: 1.5 },
  { title: 'Recommended Next Queries', key: 'recommended_next_queries', weight: 0.5 },
];

/** Intent IDs that use the full adjudicative section plan (hypothesis +
 *  falsification + contradiction).  All other intents use
 *  `DESCRIPTIVE_SECTION_PLAN`.  `undefined` (legacy runs) defaults to the
 *  adjudicative plan for backward compatibility. */
export const ADJUDICATIVE_SECTION_INTENTS = new Set<string>([
  'adjudication',
  'investigation',
  'story_verification',
]);

const KNOWN_NON_LEGACY_INTENTS = new Set<string>(
  Object.values(INTENT_OUTPUT_TEMPLATES)
    .map((template) => template.intentId)
    .filter((intentId) => intentId !== 'legacy')
);

const MAX_SECTION_SUMMARY_CHARS = 1200;
const MAX_ROLLING_SUMMARY_CHARS = 6000;
const MAX_SPECIALIST_FINDINGS_CHARS = 8000;

/** Per-section floor — even short presets must give each section enough
 *  budget to write a coherent paragraph. The total minimum
 *  (`REPORT_WORD_COUNT_MIN`) is derived from this so the per-section floor
 *  cannot push the summed budget above what the user requested. */
export const REPORT_WORD_COUNT_PER_SECTION_FLOOR = 80;

/** Bounds for user-supplied targetWordCount. Below the floor the report is
 *  too thin to be useful; above the ceiling the section drafter starts
 *  repeating itself even with steering, so we clamp to keep output
 *  substantive. The floor equals ADJUDICATIVE_SECTION_PLAN.length × per-section floor so
 *  the per-section budget allocator never has to overshoot the requested
 *  total to satisfy the per-section floor (Codex/Copilot PR #50 review). */
export const REPORT_WORD_COUNT_MIN = ADJUDICATIVE_SECTION_PLAN.length * REPORT_WORD_COUNT_PER_SECTION_FLOOR;
export const REPORT_WORD_COUNT_MAX = 12000;
export const REPORT_WORD_COUNT_DEFAULT = 2200;

/**
 * Generic structural section labels that should never become a report title.
 * A model sometimes emits these as the first heading when it is building an
 * outline before a subject-specific introduction — e.g. "Dimensions Table",
 * "Comparison Table", "Recommendation", "Overview".
 *
 * The pattern is intentionally case-insensitive and anchored to the full
 * candidate string so "Recommendation Framework for X" still passes.
 */
const STRUCTURAL_LABEL_PATTERN =
  /^(dimensions?\s*table|comparison\s*table|ranking\s*table|summary\s*table|data\s*table|recommendation|overview|introduction|findings|analysis|conclusion|results|executive\s*summary|methodology|background|appendix|references|bibliography)$/i;
const BASELINE_STRUCTURAL_LABEL_PATTERN = /^(framing|primary\s*evidence|contested\s*zones|unresolved)$/i;

export function looksLikeStructuralLabel(candidate: string): boolean {
  const value = candidate.trim();
  return STRUCTURAL_LABEL_PATTERN.test(value) || (baselineLayerEnabled() && BASELINE_STRUCTURAL_LABEL_PATTERN.test(value));
}

/**
 * Markdown block syntax that is never a report title.
 *
 * `looksLikeStructuralLabel` rejects a heading such as `# Dimensions Table`,
 * and the title fallback then walks to the next non-empty line. For a report
 * that opens with the table that heading introduced, that line is the table's
 * header row — so rejecting the label stored `| Dimension | Option A |` as the
 * title instead (Codex, PR #224). Delimiter rows, horizontal rules, and code
 * fences reach the fallback the same way and are the same defect: block
 * syntax, not a sentence.
 *
 * Each alternative is anchored to the whole trimmed line, so prose that merely
 * contains a pipe or a dash is unaffected.
 */
const MARKDOWN_BLOCK_SYNTAX_PATTERN = /^(?:\|.*|[-:|*_\s]{3,}|`{3,}.*|~{3,}.*|>\s.*)$/;

export function looksLikeMarkdownBlockSyntax(candidate: string): boolean {
  return MARKDOWN_BLOCK_SYNTAX_PATTERN.test(candidate.trim());
}

/**
 * A GitHub-flavoured Markdown table delimiter row (`| --- | :---: |`).
 *
 * Leading and trailing pipes are optional in GFM, so a header row can read
 * `Metric | Short-read | Long-read` — prose-shaped, and invisible to
 * `looksLikeMarkdownBlockSyntax`. What identifies it is the row underneath, so
 * the title fallback looks ahead one line.
 *
 * The pipe is required. Without it, `---` under a line of prose is a setext
 * heading — which is exactly the kind of line that *should* become the title.
 */
export function isTableDelimiterRow(line: string): boolean {
  const trimmed = line.trim();
  return /^[-:|\s]+$/.test(trimmed) && trimmed.includes('|') && /-{3,}/.test(trimmed);
}


/** Re-exported so existing importers of this module are unaffected by the
 *  move to `services/research/titleShaping` (Rule 44 T4). */
export { stripHeadingDecoration };

export function clampWordTarget(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return REPORT_WORD_COUNT_DEFAULT;
  return Math.max(REPORT_WORD_COUNT_MIN, Math.min(REPORT_WORD_COUNT_MAX, Math.round(n)));
}

const PLANNER_WORD_FLOOR = 60;
/**
 * The most a report is sized at when nobody chose a length: the top of the
 * range the report standard gives for a full report. A length the user chose is
 * not capped by this, and neither is a request for many items, which the
 * writer sizes to hold the items asked for.
 */
export const PLANNER_WORD_CEILING = 5000;

/**
 * Only a length the user chose counts as explicit. A planner estimate or the
 * standard default must not stop a report with many requested items from
 * growing to fit them.
 */
export function userChosenWordTarget(
  target: number | undefined,
  lengthSource: 'user' | 'planner' | 'default' | undefined
): number | undefined {
  return lengthSource === 'planner' || lengthSource === 'default' ? undefined : target;
}

/**
 * What the run passes to the report writer. With the Layer 1 switch off the
 * writer receives exactly what the user sent, as it did before the switch existed.
 */
export function synthesisLengthArgs(
  layer1: boolean,
  userTarget: number | undefined,
  decision: { target: number; source: 'user' | 'planner' | 'default' }
): { targetWordCount: number | undefined; lengthSource?: 'user' | 'planner' | 'default' } {
  return layer1 ? { targetWordCount: decision.target, lengthSource: decision.source } : { targetWordCount: userTarget };
}

/** A chosen length is clamped as the form already clamps it. An unchosen length comes from the plan. */
export function resolveReportWordTarget(args: {
  userTarget?: number;
  estimatedLength?: { minWords?: number; maxWords?: number };
}): { target: number; source: 'user' | 'planner' | 'default' } {
  if (typeof args.userTarget === 'number' && Number.isFinite(args.userTarget) && args.userTarget > 0) {
    return { target: clampWordTarget(args.userTarget), source: 'user' };
  }
  const min = args.estimatedLength?.minWords;
  const max = args.estimatedLength?.maxWords;
  const usableMin = typeof min === 'number' && Number.isFinite(min) && min > 0 ? min : null;
  const usableMax = typeof max === 'number' && Number.isFinite(max) && max > 0 ? max : null;
  if (usableMin == null && usableMax == null) {
    return { target: REPORT_WORD_COUNT_DEFAULT, source: 'default' };
  }
  const derived = usableMin != null && usableMax != null ? (usableMin + usableMax) / 2 : (usableMin ?? usableMax ?? REPORT_WORD_COUNT_DEFAULT);
  return {
    target: Math.max(PLANNER_WORD_FLOOR, Math.min(PLANNER_WORD_CEILING, Math.round(derived))),
    source: 'planner',
  };
}

export function deriveGeneratedReportTitle(query: string, markdown: string, intentId?: string): string {
  const headingMatch = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  // Decoration is stripped before the checks AND kept stripped in the result:
  // `# **Overview**` must be recognised as the structural label it is, and a
  // heading that survives should not carry raw Markdown into the title.
  const firstHeading = stripHeadingDecoration(headingMatch?.[1] ?? '');
  if (
    firstHeading &&
    firstHeading.length <= GENERATED_TITLE_MAX_LENGTH &&
    !looksLikeRawQuery(firstHeading, query) &&
    !looksLikeStructuralLabel(firstHeading)
  ) {
    return baselineLayerEnabled() ? readerTitle(query, firstHeading) : firstHeading;
  }

  const bodyLines = markdown
    .replace(/^#+\s+/gm, '')
    .split(/\n+/)
    .map((line) => line.trim());

  const firstSentence = bodyLines.find(
    (line, index) =>
      line.length > 0 &&
      !looksLikeRawQuery(line, query) &&
      // Decorated here too — `**Overview**` as a body line is the same label.
      // Only the check is stripped; the line is returned as written, so a real
      // sentence keeps its punctuation.
      !looksLikeStructuralLabel(stripHeadingDecoration(line)) &&
      !looksLikeMarkdownBlockSyntax(line) &&
      // A pipe-less table header row is only identifiable by its delimiter row.
      !isTableDelimiterRow(bodyLines[index + 1] ?? '')
  );
  if (firstSentence) {
    return trimTitle(firstSentence);
  }

  const fallbackIntentTitle = intentId
    ? intentId.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
    : 'Research Report';
  return trimTitle(`${fallbackIntentTitle} Report`);
}

/**
 * Labels a model puts in front of an echoed prompt.
 *
 * The plain `Research query:` form was already handled, but the exported `.md`
 * from run `c50162a9` still opened with `**Research query:**` — emphasised, and
 * sitting under the report's `# ` title rather than at position zero. Both
 * variants have to be covered or the reader gets ~700 lines of instructions
 * before the report (Rule 37 R-K).
 */
const PROMPT_ECHO_LABEL =
  // Emphasis may close before OR after the colon: both `**Research query**:`
  // and `**Research query:**` occur in the wild, and the second is the form
  // that survived the first fix.
  /^[*_`~]{0,3}\s*(?:research\s+(?:query|request|prompt)|user\s+(?:query|request|prompt)|original\s+(?:query|request|prompt)|query|request|prompt)\s*[*_`~]{0,3}\s*[:：]\s*[*_`~]{0,3}\s*/i;

/**
 * Index in `text` just past a whitespace-insensitive occurrence of `prompt` at
 * its start, or -1.
 *
 * Whitespace-insensitive because a model that echoes a prompt commonly re-wraps
 * it: same words, different line breaks. Byte equality misses that.
 */
function consumePromptPrefix(text: string, prompt: string): number {
  let ti = 0;
  let pi = 0;
  const isSpace = (char: string) => /\s/.test(char);

  while (pi < prompt.length) {
    if (isSpace(prompt[pi]!)) {
      while (pi < prompt.length && isSpace(prompt[pi]!)) pi += 1;
      if (ti >= text.length || !isSpace(text[ti]!)) return -1;
      while (ti < text.length && isSpace(text[ti]!)) ti += 1;
      continue;
    }
    if (ti >= text.length || text[ti] !== prompt[pi]) return -1;
    ti += 1;
    pi += 1;
  }
  return ti;
}

/** Strip one leading prompt echo, with or without a label, from a fragment. */
function stripEchoFromFragment(fragment: string, prompt: string): string {
  const text = fragment.replace(/^\s+/, '');

  const direct = consumePromptPrefix(text, prompt);
  if (direct > 0) return text.slice(direct).replace(/^\s+/, '');

  const label = text.match(PROMPT_ECHO_LABEL);
  if (label) {
    const afterLabel = text.slice(label[0].length);
    const labelled = consumePromptPrefix(afterLabel, prompt);
    // Only strip when the prompt genuinely follows the label. A section that
    // legitimately begins "Request: ..." must survive.
    if (labelled > 0) return afterLabel.slice(labelled).replace(/^\s+/, '');
  }

  return text;
}

export function stripPromptEchoFromReport(markdown: string, query: string): string {
  const trimmed = markdown.trim();
  const prompt = query.trim();
  if (!prompt) return trimmed;

  const stripped = stripEchoFromFragment(trimmed, prompt);
  if (stripped !== trimmed) return stripped;

  // The echo may sit under the report title rather than above it.
  const titleMatch = trimmed.match(/^(#\s+[^\n]*\n)([\s\S]*)$/);
  if (titleMatch) {
    const body = titleMatch[2] ?? '';
    const strippedBody = stripEchoFromFragment(body, prompt);
    if (strippedBody !== body.replace(/^\s+/, '')) {
      return `${titleMatch[1]!.trimEnd()}\n\n${strippedBody}`.trim();
    }
  }

  return trimmed;
}

export { stripInternalLabelsFromReport };

/**
 * Replace courtroom words and the stock opening in the prose of a section with
 * plain wording, and take grade labels out; link labels included. Code in every Markdown form and link
 * destinations are not read and not changed.
 */
export function removeBannedWording(content: string): string {
  // Each word is swapped for a plain one that fits the same place in the
  // sentence, so the sentence still reads. A grade token is a label, not a
  // word of the sentence, and is taken out.
  const plain: Record<string, string> = {
    verdict: 'finding',
    verdicts: 'findings',
    adjudicate: 'assess',
    adjudicated: 'assessed',
    adjudicates: 'assesses',
    adjudicating: 'assessing',
    falsified: 'disproved',
  };
  const clean = (text: string): string =>
    text
      // In brackets first, so no empty pair is left behind.
      .replace(/[ \t]*[[(]\s*(?:established[_ ]fact|strong[_ ]evidence)\s*[\])]/gi, '')
      .replace(/[ \t]*\b(?:established_fact|strong_evidence)\b/gi, '')
      .replace(/\b(?:verdicts?|adjudicat(?:e|ed|es|ing)|falsified)\b/gi, (word) => {
        const swap = plain[word.toLowerCase()] ?? word;
        return word[0] === word[0].toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap;
      })
      .replace(/\bcase (for|against)\b/gi, 'argument $1')
      .replace(/\bthis report synthesizes evidence\b/gi, 'This report draws on evidence')
      .replace(/\bthe evidence establishes\b/gi, (phrase) => (phrase[0] === 'T' ? 'The sources show' : 'the sources show'))
      .replace(/\btestimony[- ]tier\b/gi, 'first-hand')
      // A role of the pipeline named in a sentence: the reader is told who said it in plain words.
      .replace(SPOKEN_ROLE_NAME, (name) => (name[0] === 'T' ? 'This analysis' : 'this analysis'));
  // The report's own wording only: a direct quotation keeps the source's words.
  const cleanOwnWords = (text: string): string => mapOutsideQuotes(clean(text), plainClaimWords);
  // A link's label is prose the reader sees; its destination is not.
  return mapCitationProse(mapLinkLabels(content, cleanOwnWords), cleanOwnWords);
}

/** Words that follow "claim(s)" when it is a noun: "claims about", "claims are", "claim is". */
const AFTER_CLAIM_NOUN = /^(?:about|of|in|on|for|from|by|like|such|and|or|but|is|are|was|were|has|have|had|can|could|may|might|will|would|should|made|remain|remains|regarding|concerning|as|at|with|without|than|within|across|rest|rests)$/i;

/**
 * "Claim" for what a source or the report says, put in plain words. A verb
 * becomes "states"; a noun becomes "statement". The word after it decides which:
 * a noun is followed by a preposition, a conjunction or its own verb.
 */
export function plainClaimWords(text: string): string {
  return text.replace(new RegExp(`${CLAIM_WORD.source}(\\s+that\\b)?(?=(\\s+[\\p{L}]+)?)`, 'giu'), (word: string, that: string | undefined, next: string | undefined, offset: number, whole: string) => {
    const base = that ? word.slice(0, word.length - that.length) : word;
    const lower = base.toLowerCase();
    const before = whole.slice(Math.max(0, offset - 16), offset).toLowerCase();
    const nounBefore = /\b(?:the|a|this|that|these|those|its|their|his|her|such|each|every|any|no|key|main|central|numeric|specific|several|many|some|two|three|both|all|of|to|with|about|against|despite|on|for|by|from|between|regarding|contradicts?|disputes?|rejects?|supports?|challenges?|undermines?|refutes?|repeats?|echo(?:es)?|makes?|made)\s+$/.test(before);
    const nextWord = (next ?? '').trim();
    let swap: string;
    if (lower === 'claimed') swap = 'stated';
    else if (lower === 'claiming') swap = 'stating';
    else if (nounBefore || (!that && (nextWord === '' || AFTER_CLAIM_NOUN.test(nextWord)))) swap = lower === 'claims' ? 'statements' : 'statement';
    else swap = lower === 'claims' ? 'states' : 'state';
    const cased = base[0] === base[0].toUpperCase() ? swap[0].toUpperCase() + swap.slice(1) : swap;
    return `${cased}${that ?? ''}`;
  });
}

/**
 * The text of a locked report as it will be saved: prompt echo and internal
 * labels removed, banned wording put into plain words, markers numbered, and
 * the reference list and closing note added.
 *
 * This is the last check before saving. The writer's own check runs before the
 * verifier and the contract repair, and a repair can put banned wording back.
 * It is cleaned here, before numbering, so each citation is tied to the
 * sentence a reader will see. `wordingAfter` lists anything still on the page,
 * for the caller to record; nothing is shipped silently.
 */
export function finalizeLockedReportForSave(
  markdown: string,
  query: string,
  passages: LockedPassage[],
  style: ReferenceStyle = 'numeric',
  readOn?: string
): { finalized: FinalizedCitations; wordingAfter: string[] } {
  const cleaned = stripInternalLabelsFromReport(stripPromptEchoFromReport(markdown, query));
  const wordingBefore = presentationFailures(cleaned).filter((hit) => hit !== 'passage marker');
  const toSave = wordingBefore.length > 0 ? removeBannedWording(cleaned) : cleaned;
  const finalized = finalizeLockedCitations(toSave, passages, readOn, style);
  return { finalized, wordingAfter: presentationFailures(finalized.markdown) };
}

/** Told to every Layer 1 section writer. The check before saving looks for the same things. */
const READER_WORDING_RULE =
  'Never use the words claim or claims for what a source or this report says; write says, reports, states or finds. Never name a research step, a reviewer or a passage label (such as P12) in a sentence; cite with the marker only.';

export function ensureGeneratedTitleHeading(markdown: string, query: string, intentId?: string): string {
  const cleaned = stripPromptEchoFromReport(markdown, query);
  const title = deriveGeneratedReportTitle(query, cleaned, intentId);
  const headingMatch = cleaned.match(/^\s*#\s+(.+?)\s*$/m);
  if (!headingMatch) {
    return `# ${title}\n\n${cleaned}`.trim();
  }
  const currentHeading = headingMatch[1]?.trim() ?? '';
  if (!looksLikeRawQuery(currentHeading, query)) {
    return cleaned;
  }
  return cleaned.replace(/^\s*#\s+(.+?)\s*$/m, `# ${title}`);
}

/** Compute per-section word budgets from the total target, distributed by the
 *  per-section `weight`. Sections whose weighted share falls below the
 *  per-section floor are pinned at the floor and the deficit is
 *  redistributed across the remaining sections. Pinning is iterated to a
 *  fixed point: if a previously-non-floored section drops below the floor
 *  during redistribution, it is pinned too, and the loop runs again. The
 *  result is the smallest budget assignment that respects the floor while
 *  summing as close as possible to `totalWords`.
 *
 *  Contract: at totalWords == REPORT_WORD_COUNT_MIN every section sits at
 *  exactly the floor and the sum equals `totalWords` (verified by the
 *  reportLengthSteering test suite). For larger totals the sum tracks the
 *  request within ≤ sectionPlan.length words of `Math.round` slack.
 *
 *  `sectionPlan` defaults to `ADJUDICATIVE_SECTION_PLAN` (adjudicative 10-section plan)
 *  for backward compatibility. Pass `DESCRIPTIVE_SECTION_PLAN` for
 *  non-adjudicative intent routing. */
export function distributeWordBudget(
  totalWords: number,
  sectionPlan: Array<{ key: string; weight: number }> = ADJUDICATIVE_SECTION_PLAN,
  floor = REPORT_WORD_COUNT_PER_SECTION_FLOOR
): Map<string, number> {
  const flooredKeys = new Set<string>();

  // Iterate to a fixed point. Each pass may newly pin sections whose
  // redistributed share still falls below the floor.
  let changed = true;
  while (changed) {
    changed = false;
    const flooredCost = flooredKeys.size * floor;
    const remainingTotal = Math.max(0, totalWords - flooredCost);
    const remainingWeight = sectionPlan
      .filter((s) => !flooredKeys.has(s.key))
      .reduce((s, sec) => s + sec.weight, 0);
    if (remainingWeight === 0) break;

    for (const sec of sectionPlan) {
      if (flooredKeys.has(sec.key)) continue;
      const share = remainingTotal * (sec.weight / remainingWeight);
      if (share < floor) {
        flooredKeys.add(sec.key);
        changed = true;
      }
    }
  }

  const flooredCost = flooredKeys.size * floor;
  const remainingTotal = Math.max(0, totalWords - flooredCost);
  const remainingWeight = sectionPlan
    .filter((s) => !flooredKeys.has(s.key))
    .reduce((s, sec) => s + sec.weight, 0);

  const budgets = new Map<string, number>();
  for (const sec of sectionPlan) {
    if (flooredKeys.has(sec.key) || remainingWeight === 0) {
      budgets.set(sec.key, floor);
    } else {
      const share = sec.weight / remainingWeight;
      budgets.set(sec.key, Math.round(remainingTotal * share));
    }
  }
  return budgets;
}

export function formatLengthDirective(target: number, sectionTarget: number, sectionTitle: string): string {
  return [
    '',
    'LENGTH GUIDANCE — strict but substantive:',
    `- Whole report target: ~${target} words across all sections.`,
    `- This section ("${sectionTitle}") target: ~${sectionTarget} words (±15%).`,
    '- Use the budget on substance, not filler. Each paragraph must add a new fact, evidence chain, contradiction, or synthesis step.',
    '- If you run out of substantive material, STOP early — do not pad with restatements, generic caveats, or marketing language.',
    '- Cite the specific sources behind every factual statement.',
    '- Be precise: do not hedge statements more than the sources require, and do not overstate them to fill space.',
  ].join('\n');
}

function safeJsonParse<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function titleFromTemplateSection(sectionKey: string): string {
  return sectionKey
    .split('_')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}


function looksLikeRawQuery(candidate: string, query: string): boolean {
  const normalizedCandidate = candidate.replace(/\s+/g, ' ').trim().toLowerCase();
  const normalizedQuery = query.replace(/\s+/g, ' ').trim().toLowerCase();
  return normalizedCandidate.length > 0 && normalizedQuery.startsWith(normalizedCandidate);
}

function sectionPlanFromTemplate(templateId: string): RuntimeSectionPlanEntry[] {
  const template = getIntentOutputTemplate(templateId);
  const weight = template.sections.length > 0 ? 1 / template.sections.length : 1;
  return template.sections.map((sectionKey) => ({
    key: sectionKey,
    title: titleFromTemplateSection(sectionKey),
    weight,
  }));
}

const REQUESTED_FORMAT_SECTIONS: Record<string, { key: string; title: string }> = {
  ranked_options: { key: 'ranked_options', title: 'Ranked options' },
  narrative_briefing: { key: 'narrative_briefing', title: 'Narrative briefing' },
  step_by_step_guide: { key: 'step_by_step_guide', title: 'Steps' },
  comparison_table: { key: 'comparison_table', title: 'Comparison table' },
  structured_report: { key: 'structured_report', title: 'Structured report' },
};

/** Keep the intent plan and add the structure the form asked for, if it is not already there. */
function appendRequestedFormatSections(
  plan: RuntimeSectionPlanEntry[],
  formats: string[]
): RuntimeSectionPlanEntry[] {
  const next = plan.some((section) => section.key === 'summary')
    ? [...plan]
    : [{ key: 'summary', title: 'Summary', weight: 1 }, ...plan];
  for (const format of formats) {
    const slot = REQUESTED_FORMAT_SECTIONS[format];
    if (!slot || next.some((section) => section.key === slot.key)) continue;
    next.push({ ...slot, weight: 1 });
  }
  return next;
}

export async function generateIterativeReport(args: {
  query: string;
  plan: unknown;
  sourceContext: string;
  retrieverAnalysis: string;
  reasoningChains: string;
  challenges: string;
  specialistFindings?: string;
  /**
   * Set when the evidence-sufficiency gate found little independent
   * corroboration. This is a SYNTHESIS MODIFIER — the full deliverable is
   * still produced, with explicit uncertainty labelling. It must never cause
   * synthesis to be skipped or replaced with a template (Rule 37 R-L).
   */
  limitedSourcingDirective?: string;
  /**
   * Requested artifacts from the confirmed brief (WO-AC R1/R2).
   *
   * Drives outline expansion and the word budget: a request for N items with
   * required subsections gets N drafting slots and a budget sized to the
   * contract, instead of being compressed into the intent's static plan.
   */
  contractArtifacts?: readonly ContractArtifact[];
  engineVersion?: string;
  researchObjective?: ResearchObjective;
  allowFallbackByRole?: Record<string, boolean>;
  requestedFormats?: string[];
  /** User-requested total report length in words. Clamped to
   *  [REPORT_WORD_COUNT_MIN, REPORT_WORD_COUNT_MAX]. Falls back to
   *  REPORT_WORD_COUNT_DEFAULT if not provided. */
  targetWordCount?: number;
  /** A planner-sized target may be under the form minimum. A user choice is not. */
  lengthSource?: 'user' | 'planner' | 'default';
  byokApiKeyOverride?: string;
  /** Intent ID from the orchestration profile. `undefined` (legacy runs)
   *  defaults to the full adjudicative section plan for backward
   *  compatibility. */
  intentId?: string;
  outputTemplateId?: string;
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
  skipChallenger?: boolean;
  isAdjudicative?: boolean;
  usedSources?: UsedSource[];
  /**
   * Passages the writer must cite by marker. Present only when the citation lock
   * is on. The markers stay in the returned text; the caller turns them into
   * reader numbers and builds the reference list before the report is saved.
   */
  lockedPassages?: LockedPassage[];
}): Promise<{
  markdown: string;
  sections: ReportSectionDraft[];
  outline: string[];
  targetWordCount: number;
  plannedItemTitles: ReadonlySet<string>;
  /** How many sections the refiner returned usably; the rest kept their draft. */
  refinedSectionCount: number;
  /** Sections whose second draft still cited a marker they were not shown; those markers were removed. */
  citationIssues: Array<{ section: string; markers: string[] }>;
  /**
   * Every role call this function made, for `research_runs.model_log`.
   *
   * These used to be discarded at this boundary, so the Run Summary's MODEL
   * USAGE table showed no `outline_architect` and no `section_drafter` — the
   * two roles that write the report — and its token totals omitted the whole
   * synthesis phase, the largest single cost centre in a run. Cost telemetry
   * was never affected (`emitCallTelemetry` fires inside `callRoleModel`); only
   * the user-facing summary was.
   */
  modelCalls: Awaited<ReturnType<typeof callRoleModel>>[];
}> {
  const modelCalls: Awaited<ReturnType<typeof callRoleModel>>[] = [];
  let activeSectionPlan: RuntimeSectionPlanEntry[];
  let templateNarrativeHint = '';
  let templateVerifierRubric = '';
  let templateRequiredDeliverables: readonly string[] = [];
  const chosenFormats = (args.requestedFormats ?? []).filter((format) => format && format !== 'automatic');
  const useReaderHeadings = baselineLayerEnabled() && args.isAdjudicative !== true && chosenFormats.length === 0;
  if (args.outputTemplateId) {
    const template = getIntentOutputTemplate(args.outputTemplateId);
    if (args.intentId && template.intentId !== args.intentId) {
      throw new Error(
        `INTENT_TEMPLATE_MISMATCH: intent=${args.intentId} template=${args.outputTemplateId} templateIntent=${template.intentId}`
      );
    }
    activeSectionPlan = sectionPlanFromTemplate(args.outputTemplateId);
    if (baselineLayerEnabled() && args.isAdjudicative !== true && chosenFormats.length === 0) {
      activeSectionPlan = draftedSections(args.intentId, args.query);
    } else if (baselineLayerEnabled() && args.isAdjudicative !== true) {
      activeSectionPlan = appendRequestedFormatSections(activeSectionPlan, chosenFormats);
    }
    templateNarrativeHint = template.narrativeHint;
    templateVerifierRubric = template.verifierRubric;
    templateRequiredDeliverables = template.requiredDeliverables;
  } else if (args.intentId && KNOWN_NON_LEGACY_INTENTS.has(args.intentId)) {
    throw new Error(`INTENT_TEMPLATE_MISSING: known intent "${args.intentId}" requires outputTemplateId`);
  } else {
    activeSectionPlan =
      args.intentId != null && !ADJUDICATIVE_SECTION_INTENTS.has(args.intentId)
        ? DESCRIPTIVE_SECTION_PLAN
        : ADJUDICATIVE_SECTION_PLAN;
  }

  // WO-AC R1 — expand the intent's static plan to fit the request's contract.
  // Five fixed sections cannot hold 20 items x 5 subsections plus a blueprint;
  // the drafter writes what fits and stops. Expanding gives each item its own
  // drafting slot (and makes it independently repairable — R3).
  // Named deliverables the intent plan has no slot for ("Cross-Opportunity
  // Analysis", "Final Winner") get their own drafting slot. Without this the
  // drafter is never asked for them, the auditor reports them missing, and
  // repair spends a pass bolting them on (run `c50162a9`).
  //
  // Added BEFORE expansion so the expansion's word-budget cap counts them.
  // Appending afterwards let an 800-word plan capped at 10 sections grow to 12+,
  // each then pinned to the per-section floor, so the plan's own minimum
  // exceeded the target the prompt was still quoting (Codex review, PR #209).
  const contractSections = appendContractRequiredSections({
    plan: activeSectionPlan,
    artifacts: args.contractArtifacts,
    repeatedArtifact: findRepeatedArtifact(args.contractArtifacts),
  });
  activeSectionPlan = contractSections.plan;

  const outlineExpansion = expandSectionPlanForContract({
    basePlan: activeSectionPlan,
    artifacts: args.contractArtifacts,
    intentId: args.intentId,
    explicitWordTarget: userChosenWordTarget(args.targetWordCount, args.lengthSource),
    perSectionFloor: REPORT_WORD_COUNT_PER_SECTION_FLOOR,
  });
  activeSectionPlan = outlineExpansion.plan;

  const v2 = {
    engineVersion: args.engineVersion,
    researchObjective: args.researchObjective,
    allowFallbackByRole: args.allowFallbackByRole,
    byokApiKeyOverride: args.byokApiKeyOverride,
    isAdjudicative: args.isAdjudicative,
    baselineLayer: baselineLayerEnabled() && args.isAdjudicative !== true,
  };
  const lockedPassages =
    // An empty list is still a lock: nothing was retrieved, so nothing may be cited.
    baselineLayerEnabled() && args.isAdjudicative !== true && args.lockedPassages
      ? args.lockedPassages
      : null;
  const citationIssues: Array<{ section: string; markers: string[] }> = [];

  // WO-AC R2 — scale the word budget to the contract. A 107-block deliverable
  // must not share a default budget with a four-section explainer. An explicit
  // user target always wins.
  const repeatedArtifact = findRepeatedArtifact(args.contractArtifacts);
  const requiredFieldsPerItem =
    (repeatedArtifact?.explicitRequiredFields?.length ?? 0) +
    (repeatedArtifact?.inferredRequiredFields?.length ?? 0);
  const contractTarget = deriveContractWordTarget({
    explicitTarget: userChosenWordTarget(args.targetWordCount, args.lengthSource),
    itemCount: outlineExpansion.itemCount,
    requiredFieldsPerItem,
    baselineWords: clampWordTarget(undefined),
  });
  // One exception to the planner ceiling: a request for many items, each with
  // required fields, is sized to hold them (`contractTarget`) even when that is
  // more than the ceiling. Twenty items with five fields each do not fit in
  // 5,000 words, and cutting them to fit would drop what was asked for.
  const targetWordCount = args.lengthSource === 'planner'
    ? (contractTarget ?? Math.max(PLANNER_WORD_FLOOR, Math.min(REPORT_WORD_COUNT_MAX, Math.round(args.targetWordCount ?? PLANNER_WORD_FLOOR))))
    : clampWordTarget(contractTarget ?? args.targetWordCount);
  if (baselineLayerEnabled() && args.isAdjudicative !== true && targetWordCount < 300) {
    activeSectionPlan = [{ key: 'summary', title: 'Summary', weight: 1 }];
  }
  const contractWantsTable = contractRequestsTable(args.contractArtifacts, args.requestedFormats);

  // Required field NAMES must reach the drafter. Fields can be inferred by the
  // planner or edited at plan confirmation, so they may not appear anywhere in
  // the original query — the drafter would then omit them and fail
  // `adaptiveFieldCompletenessForOpportunities`, re-entering the very repair
  // loop this work order removes (Codex review, PR #205).
  const confirmedFields = Array.from(
    new Set([
      ...(repeatedArtifact?.explicitRequiredFields ?? []),
      ...(repeatedArtifact?.inferredRequiredFields ?? []),
    ].map((field) => field.trim()).filter(Boolean))
  );
  // Owned by the report type, not guessed from the brief's prose.
  const itemLabel = deriveItemLabel(repeatedArtifact, args.intentId);
  const confirmedFieldsBlock =
    confirmedFields.length > 0
      ? `Confirmed required fields for EVERY ${itemLabel.toLowerCase()} in this report:\n${confirmedFields
          .map((field) => `- ${field}`)
          .join('\n')}\nEvery one of these must appear for every item. Do not rename or omit them.`
      : '';
  // The exact header row, so "same number of cells as the header" is a rule the
  // drafter can actually follow (run `c50162a9`: 19 of 20 rows disagreed with a
  // header the drafter had invented itself).
  const tableHeaderDirective = buildTableHeaderDirective({
    fields: confirmedFields,
    itemLabel,
    rowCount: repeatedArtifact?.exactCount,
  });
  // Exactly one section carries the exact schema and row count. Every section
  // still gets the generic table hygiene rules, which are safe to repeat.
  const tableSectionKey = resolveTableSectionKey(activeSectionPlan, contractWantsTable);
  const requestedFormatsBlock =
    Array.isArray(args.requestedFormats) && args.requestedFormats.length > 0
      ? `Requested presentation formats:\n${args.requestedFormats.map((format) => `- ${format}`).join('\n')}`
      : 'Requested presentation formats:\n- automatic / best fit';
  let sectionBudgets = distributeWordBudget(targetWordCount, activeSectionPlan);
  const outlineResponse = await callRoleModel({
    role: 'outline_architect',
    ...v2,
    messages: [
      { role: 'system', content: getSystemPrompt('outline_architect', args.isAdjudicative ?? false) },
      {
        role: 'user',
        content: `Generate a report outline for query "${args.query}".
Required sections:\n${activeSectionPlan.map((s) => `- ${s.title}`).join('\n')}
Template narrative guidance:\n${templateNarrativeHint || 'none'}
Required deliverables:\n${templateRequiredDeliverables.length > 0 ? templateRequiredDeliverables.map((d) => `- ${d}`).join('\n') : '- none'}
Intent verifier rubric:\n${templateVerifierRubric || 'none'}
${requestedFormatsBlock}
Plan:\n${JSON.stringify(args.plan, null, 2)}
Source material:\n${args.sourceContext.slice(0, 8000)}
Specialist findings:\n${(args.specialistFindings ?? 'none').slice(0, MAX_SPECIALIST_FINDINGS_CHARS)}
${useReaderHeadings ? `Write the report title and the subject headings from the source material. Each must be a grammatical noun phrase. Do not repeat the question. Do not use a structural label such as Summary, Findings, Overview, or Framing.
Return strict JSON only: {"title":"noun phrase","outline":["noun phrase","noun phrase"]}` : 'Return strict JSON only.'}`,
      },
    ],
  });

  modelCalls.push(outlineResponse);

  const layer1 = baselineLayerEnabled() && args.isAdjudicative !== true;
  const outlinePayload = safeJsonParse<{ title?: string; outline?: Array<{ title?: string } | string> }>(
    layer1 ? outlineResponse.content.replace(/```(?:json)?/gi, '').replace(/```/g, '') : outlineResponse.content
  );
  const outline = (outlinePayload?.outline ?? [])
    .map((s) => (typeof s === 'string' ? s : s.title || '').trim())
    .filter(Boolean);
  let resolvedOutline = outline.length > 0 ? outline : activeSectionPlan.map((s) => s.title);
  let acceptedTitle = acceptSubjectHeading(args.query, outlinePayload?.title ?? '') ? outlinePayload?.title?.trim() ?? '' : '';
  if (useReaderHeadings) {
    const accepted = outline.filter((heading) => acceptSubjectHeading(args.query, heading));
    if (!acceptedTitle || accepted.length < 2) {
      const revision = await callRoleModel({
        role: 'outline_architect',
        ...v2,
        baselineLayer: true,
        messages: [
          { role: 'system', content: 'Write grammatical noun-phrase headings from the source material. Do not repeat the question.' },
          {
            role: 'user',
            content: `Source material:\n${args.sourceContext.slice(0, 8000)}\nQuestion: ${args.query}\nReturn strict JSON only: {"title":"noun phrase","outline":["noun phrase","noun phrase"]}`,
          },
        ],
      });
      modelCalls.push(revision);
      const revised = safeJsonParse<{ title?: string; outline?: Array<{ title?: string } | string> }>(
        revision.content.replace(/```(?:json)?/gi, '').replace(/```/g, '')
      );
      const revisedHeadings = (revised?.outline ?? [])
        .map((s) => (typeof s === 'string' ? s : s.title || '').trim())
        .filter((heading) => acceptSubjectHeading(args.query, heading));
      if (revisedHeadings.length > 0) resolvedOutline = revisedHeadings;
      if (acceptSubjectHeading(args.query, revised?.title ?? '')) acceptedTitle = revised?.title?.trim() ?? acceptedTitle;
    } else {
      resolvedOutline = accepted;
    }
    const usable = resolvedOutline.filter((heading) => acceptSubjectHeading(args.query, heading));
    let topic = 0;
    activeSectionPlan = activeSectionPlan
      .map((section) => {
        if (!section.key.startsWith('topic_')) return section;
        const title = usable[topic];
        topic += 1;
        return title ? { ...section, title } : section;
      })
      .filter((section) => section.title !== 'Pending subject');
    // Sized by what each section is for, now that the subject sections are known.
    sectionBudgets = readerSectionBudgets(targetWordCount, activeSectionPlan);
  }
  /** How far over its share a section may run before it is asked to be shorter, and the most it may keep. */
  const OVER_BUDGET = 1.35;

  const sections: ReportSectionDraft[] = [];
  let rollingSummary = '';
  // Item headings as finally composed, which is what the contract auditor
  // matches against. Built during drafting, not guessed from the output.
  const resolvedItemTitles: string[] = [];

  /** Ask for a concrete item name — only on sections that represent an item. */
  const itemNameDirectiveFor = (entry: { itemOrdinal?: number; itemLastOrdinal?: number }): string => {
    if (typeof entry.itemOrdinal !== 'number') return '';
    if (typeof entry.itemLastOrdinal === 'number' && entry.itemLastOrdinal > entry.itemOrdinal) {
      // Grouped sections cover a range, so there is no single name to give.
      return '';
    }
    return `First line of your output must be exactly:
ITEM NAME: <a short, concrete name for this ${itemLabel.toLowerCase()}, at most ${MAX_ITEM_NAME_CHARS} characters>
This line is consumed by the system and removed before the reader sees the report.
It becomes the section heading, so name the thing itself — not a restatement of the request.
Write the section body starting on the following line.`;
  };

  /**
   * Draft one section against a fixed context snapshot.
   *
   * `contextSummary` is passed in rather than read from a mutable outer
   * variable: item sections run concurrently, so there is no single "previous
   * sections" state they could share, and reading a value that other workers
   * are mutating would make output depend on completion order.
   */
  const draftSection = async (
    section: RuntimeSectionPlanEntry,
    contextSummary: string
  ): Promise<ReportSectionDraft> => {
    const sectionTarget = sectionBudgets.get(section.key) ?? Math.round(targetWordCount / activeSectionPlan.length);
    const lengthDirective = formatLengthDirective(targetWordCount, sectionTarget, section.title);
    const rollingSummary = contextSummary;

    const shownPassages = lockedPassages
      ? passagesForSection(lockedPassages, [section.title, args.query], { broad: !isSubjectSection(section) })
      : null;
    const drafterMessages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
        { role: 'system', content: getSystemPrompt('section_drafter', args.isAdjudicative ?? false) },
        {
          role: 'user',
          content: `Section to draft: ${section.title}
Research query: ${args.query}
Plan: ${JSON.stringify(args.plan)}
Retriever analysis: ${args.retrieverAnalysis}
Reasoning output: ${args.reasoningChains}
Skeptic output: ${args.challenges}
Specialist findings: ${args.specialistFindings ?? 'none'}
Template narrative guidance: ${templateNarrativeHint || 'none'}
${args.isAdjudicative ? '' : `\n${CLAIM_CLASS_SOURCING_BURDEN}\n`}${
            sectionExpectsTable({ title: section.title, key: section.key, contractWantsTable })
              ? `${TABLE_FORMATTING_RULES}${
                  section.key === tableSectionKey ? `\n${tableHeaderDirective}` : ''
                }`
              : ''
          }
${args.limitedSourcingDirective ? `\n${args.limitedSourcingDirective}\n` : ''}
${confirmedFieldsBlock}
Required deliverables for this intent:\n${templateRequiredDeliverables.length > 0 ? templateRequiredDeliverables.map((d) => `- ${d}`).join('\n') : '- none'}
Verifier rubric for this intent:\n${templateVerifierRubric || 'none'}
${requestedFormatsBlock}
${itemNameDirectiveFor(section)}
Source material: ${shownPassages ? formatLockedContext(shownPassages, stripGradeLines) : baselineLayerEnabled() && args.isAdjudicative !== true ? stripGradeLines(args.sourceContext) : args.sourceContext}
Rolling summary from previous sections: ${rollingSummary || 'none yet'}
${lengthDirective}
${layer1 && section.key === 'summary' ? 'The summary must answer the question directly in 150 words or less.' : ''}
${layer1 && section.key === 'disagreement' ? 'If the sources do not disagree, say so plainly in one sentence. Do not invent a disagreement.' : ''}
${useReaderHeadings ? readerSectionRule(section.key) : ''}
${layer1 ? READER_WORDING_RULE : ''}
${shownPassages ? `${LOCK_INSTRUCTION} Do not mention section keys, topic numbers, or system markers.` : layer1 ? 'A sentence drawn from CHUNK n ends with [n] before the full stop. Do not mention section keys, topic numbers, or system markers.' : ''}
Return section body text only. Do NOT write a markdown heading for this section — the heading is added for you.`,
        },
    ];
    let sectionResult = await callRoleModel({ role: 'section_drafter', ...v2, messages: drafterMessages });

    modelCalls.push(sectionResult);

    // Citation lock: a marker the section was not shown is not a source. The
    // section is drafted once more with the offending markers named. If the
    // second draft still cites one, those markers are removed and the removal
    // is reported, so a reader never sees a citation with nothing behind it.
    let draftedText = sectionResult.content;
    if (shownPassages) {
      const unknown = unknownMarkers(draftedText, shownPassages);
      if (unknown.length > 0) {
        const retry = await callRoleModel({
          role: 'section_drafter',
          ...v2,
          messages: [
            ...drafterMessages,
            { role: 'assistant', content: draftedText },
            {
              role: 'user',
              content: `That draft cites ${unknown.map((marker) => `[${marker}]`).join(', ')}, which you were not shown. Rewrite the section using only the markers shown in the source material. Where no shown passage supports a sentence, remove the sentence.`,
            },
          ],
        });
        modelCalls.push(retry);
        sectionResult = retry;
        draftedText = retry.content;
        const stillUnknown = unknownMarkers(draftedText, shownPassages);
        if (stillUnknown.length > 0) {
          citationIssues.push({ section: section.title, markers: stillUnknown });
          draftedText = stripUnknownMarkers(draftedText, shownPassages);
        }
      }
    }

    // Shape and size (report standard): key findings are a short list, and no
    // section runs far past its share. The writer is asked once, with the
    // passages still in front of it; what it returns is held to the same lock.
    if (useReaderHeadings && isSizedReaderSection(section.key)) {
      const tooLong = wordCount(draftedText) > sectionTarget * OVER_BUDGET;
      const notAList = section.key === 'key_findings' && !isBulletList(draftedText.trim());
      if (tooLong || notAList) {
        const ask = notAList
          ? `Rewrite this as 3 to 7 bullet points and nothing else. Each bullet starts with "- ", is one sentence, and ends with its citation. Keep it under ${sectionTarget} words.`
          : `That draft is ${wordCount(draftedText)} words. This section may use about ${sectionTarget}. Rewrite it within ${sectionTarget} words: keep the most important points with their citations, and leave out anything the summary or an earlier section already says.`;
        const shorter = await callRoleModel({
          role: 'section_drafter',
          ...v2,
          messages: [...drafterMessages, { role: 'assistant', content: draftedText }, { role: 'user', content: ask }],
        });
        modelCalls.push(shorter);
        let shorterText = shorter.content;
        if (shownPassages) {
          const unknown = unknownMarkers(shorterText, shownPassages);
          if (unknown.length > 0) {
            citationIssues.push({ section: section.title, markers: unknown });
            shorterText = stripUnknownMarkers(shorterText, shownPassages);
          }
        }
        // Kept only when it did what was asked; a rewrite that came back longer is not an improvement.
        if (shorterText.trim() && (notAList ? isBulletList(shorterText.trim()) || wordCount(shorterText) < wordCount(draftedText) : wordCount(shorterText) < wordCount(draftedText))) {
          sectionResult = shorter;
          draftedText = shorterText;
        }
      }
    }

    // Headings are composed here, from the plan's ordinal, the report type's
    // label, and the drafter's declared item name. The model never authors one,
    // so the contract auditor matches exactly rather than pattern-matching prose.
    const { itemName, content: sectionText } = extractItemName(draftedText.trim());
    const finalTitle =
      typeof section.itemOrdinal === 'number'
        ? composeItemHeading({
            ordinal: section.itemOrdinal,
            label: itemLabel,
            itemName,
            lastOrdinal: section.itemLastOrdinal,
          })
        : section.title;

    return {
      title: finalTitle,
      key: section.key,
      // The assembler prepends the heading, so the drafter's own copy of it
      // would render twice — with the ordinal in it twice. Only a copy: a
      // section that opens with `### Risks` keeps its `### Risks`.
      content: stripLeadingSectionHeading(sectionText, finalTitle),
    };
  };

  let drafted = 0;
  // Progress callbacks are SERIALISED, not merely counted. The production
  // callback emits a socket event and updates one `research_runs` row; run
  // concurrently, a slower section 1 write could land after section 2 and move
  // persisted progress backwards (Codex + Copilot review, PR #210).
  let progressChain: Promise<unknown> = Promise.resolve();
  const announce = (title: string): Promise<void> => {
    // Emitted on COMPLETION, not before drafting: with a concurrency pool the
    // sections finish out of order, so "about to draft #3" would be a lie.
    drafted += 1;
    const index = drafted;
    const emit = () => args.onSectionProgress?.({ title, index, total: activeSectionPlan.length });
    // Run after the previous emission regardless of whether it succeeded — one
    // failed progress write must not stall every later section — but surface
    // THIS emission's failure to its caller, so cancellation still propagates.
    const emission = progressChain.then(emit, emit);
    progressChain = emission.then(
      () => undefined,
      () => undefined
    );
    return emission.then(() => undefined);
  };

  const appendToSummary = (summary: string, draft: ReportSectionDraft, perSectionChars: number): string =>
    `${summary}\n\n[${draft.title}]\n${draft.content.slice(0, perSectionChars)}`.slice(-MAX_ROLLING_SUMMARY_CHARS);

  const draftSequentially = async (plan: readonly RuntimeSectionPlanEntry[]): Promise<void> => {
    for (const section of plan) {
      const draft = await draftSection(section, rollingSummary);
      sections.push(draft);
      if (typeof section.itemOrdinal === 'number') resolvedItemTitles.push(draft.title.toLowerCase());
      rollingSummary = appendToSummary(rollingSummary, draft, MAX_SECTION_SUMMARY_CHARS);
      await announce(draft.title);
    }
  };

  const { leading, items, trailing } = partitionSectionPlan(activeSectionPlan);

  await draftSequentially(leading);

  if (items.length > 0) {
    // Every item section sees the same context — the framing written before
    // them — because none of them depends on another. This is what makes them
    // safe to run concurrently; framing sections, which summarise and rank the
    // items, stay sequential and run after.
    const itemContext = rollingSummary;
    const itemDrafts = await mapWithConcurrency(items, SECTION_DRAFT_CONCURRENCY, async (section) => {
      const draft = await draftSection(section, itemContext);
      await announce(draft.title);
      return draft;
    });

    for (const draft of itemDrafts) {
      sections.push(draft);
      resolvedItemTitles.push(draft.title.toLowerCase());
    }

    // Give the trailing sections EVERY item. Appending item by item and letting
    // the summary's tail-slice enforce the cap silently dropped the head, so a
    // ranking section saw only the last few of twenty items it was asked to
    // rank. The digest is budgeted up front instead.
    const framingReserve = framingContextChars(MAX_ROLLING_SUMMARY_CHARS);
    const framingContext = rollingSummary.slice(-framingReserve);
    const digest = buildItemDigest(itemDrafts, MAX_ROLLING_SUMMARY_CHARS - framingReserve);
    rollingSummary = framingContext ? `${framingContext}\n\n${digest}` : digest;
  }

  await draftSequentially(trailing);

  const challenger = args.skipChallenger
    ? { content: '', model: 'skipped-by-profile', role: 'internal_challenger' as const, promptTokens: 0, completionTokens: 0, durationMs: 0, usedFallback: false, primaryModel: 'skipped-by-profile' }
    : await callRoleModel({
        role: 'internal_challenger',
        ...v2,
        isAdjudicative: args.isAdjudicative,
        messages: [
          { role: 'system', content: getSystemPrompt('internal_challenger', args.isAdjudicative ?? false) },
          {
            role: 'user',
            content: `Challenge this draft report for weak assumptions and unsupported jumps:
${sections
              .map((s) => `## ${s.title}
${s.content}`)
              .join('\n\n')}`,
          },
        ],
      });


  const refinement = await callRoleModel({
    role: 'coherence_refiner',
    ...v2,
    messages: [
      { role: 'system', content: getSystemPrompt('coherence_refiner', args.isAdjudicative ?? false) },
      {
        role: 'user',
        content: `Refine report text while preserving epistemic integrity.

You see the WHOLE report so you can fix cross-section flow, redundancy, and
contradictions between sections. You return it as the same labelled blocks.

OUTPUT FORMAT (MANDATORY). For each section below, emit exactly:

${SECTION_BLOCK_OPEN_EXAMPLE}
<revised body text for that section>
${SECTION_BLOCK_CLOSE}

Rules:
- Emit one block per section, all ${sections.length} of them, in the given order.
- Copy each "key" value exactly. It is how your text is routed back into the report.
- Do NOT write "## " headings. Headings are added by the system; any you write
  will appear as stray text in the middle of a section.
- Body text only inside each block. No commentary about the revision.

Challenger findings:\n${challenger.content}

DRAFT SECTIONS:\n${formatSectionsForRefiner(sections).join('\n\n')}

${requestedFormatsBlock}

${layer1
  ? `LENGTH GUIDANCE: the full report should stay close to ~${targetWordCount} words. Tighten redundant phrasing and remove a fact a section repeats from an earlier one. Never lengthen a section and never add material.`
  : `LENGTH GUIDANCE: keep the full report close to ~${targetWordCount} words. Tighten redundant phrasing but do not delete substantive findings or counterarguments. If a section is materially under its share of the budget, extend it with substantive analysis from the challenger findings rather than padding.`}`,
      },
    ],
  });

  // Reassemble from the drafted sections, substituting refined bodies where the
  // refiner returned a usable block. A section the refiner dropped, renamed, or
  // emptied keeps its drafted text — a coherence pass must never be able to
  // delete delivered work, and partial refinement beats discarding the report.
  modelCalls.push(challenger, refinement);

  const refinedBodies = parseRefinedSections(
    refinement.content,
    new Map(sections.map((section) => [section.key, section.title]))
  );
  const stripMachineFiller = (text: string): string =>
    text
      .replace(/<<<[^>\n]*>>>?/g, '')
      .replace(/\bTopic \d+ establishes (?:the |that )?/gi, '')
      .replace(/\bKey findings establish /gi, '')
      .trim();
  const finalSections: ReportSectionDraft[] = sections.map((section) => {
    const refined = refinedBodies.get(section.key);
    const draftHasCitation = /\[(?:P)?\d+[\],;]/.test(section.content);
    const refinedHasCitation = refined ? /\[(?:P)?\d+[\],;]/.test(refined) : false;
    // Locked: the refiner sees the draft, not the passages, so its version is
    // kept only when every citation is where the drafter put it.
    const refinedKeepsLock = !lockedPassages || !refined || markersPreserved(section.content, refined, { allowRemoval: false });
    const content = layer1 && refined && refinedKeepsLock && (!draftHasCitation || refinedHasCitation) ? refined : refined && !layer1 ? refined : section.content;
    return { ...section, content: layer1 ? stripMachineFiller(content) : content };
  });

  let prepared = finalSections;
  if (baselineLayerEnabled() && args.isAdjudicative !== true && repeatedSentences(prepared).length > 0) {
    const rewrite = await callRoleModel({
      role: 'coherence_refiner',
      ...v2,
      baselineLayer: true,
      messages: [
        { role: 'system', content: 'Remove repeated sentences. Keep paragraphs, lists, tables and code. Do not add facts.' },
        { role: 'user', content: prepared.map((section) => `## ${section.title}\n${section.content}`).join('\n\n') },
      ],
    });
    modelCalls.push(rewrite);
    const deduplicated = parseRewrittenSections(rewrite.content, prepared);
    prepared = deduplicated
      ? lockedPassages
        ? keepRewritesThatPreserveMarkers(prepared, deduplicated, { allowRemoval: true })
        : deduplicated
      : prepared;
  }
  const sized = (section: ReportSectionDraft): ReportSectionDraft => {
    if (section.key === 'summary') {
      return wordCount(section.content) > 150 ? { ...section, content: trimSummaryAtSentence(section.content) } : section;
    }
    if (!useReaderHeadings || !isSizedReaderSection(section.key)) return section;
    // The last word on shape and size, after every rewrite has had its turn.
    // Whole sentences and whole bullets only, so a citation leaves with its sentence.
    if (section.key === 'limits') return { ...section, content: firstSentences(section.content, 4) };
    const budget = sectionBudgets.get(section.key);
    const shaped = section.key === 'key_findings' ? capBullets(section.content, 7) : section.content;
    const content = budget ? trimToWords(shaped, Math.round(budget * OVER_BUDGET)) : shaped;
    if (content !== section.content) {
      logger.info('report_section_trimmed', { section: section.key, from: wordCount(section.content), to: wordCount(content) });
    }
    return { ...section, content };
  };
  const cleaned = layer1 ? removeRepeatedSentences(prepared).map(sized) : prepared;
  // With the citation lock on, markers stay as issued. The caller numbers them
  // and adds the reference list and closing note just before the report is saved,
  // after verification and repair, so those steps cannot break the binding.
  const numbered = lockedPassages
    ? { sections: cleaned.filter((section) => section.key !== 'references' && section.key !== 'about'), cited: [] as UsedSource[] }
    : layer1
      ? renumberCitations(cleaned, args.usedSources ?? [])
      : { sections: cleaned, cited: [] as UsedSource[] };
  const cited = numbered.cited;
  const references = buildReferences(cited);
  const readCount = distinctSourceCount(args.usedSources ?? []);
  const withSystem = lockedPassages
    ? numbered.sections
    : layer1
    ? [
        ...numbered.sections.filter((section) => section.key !== 'references' && section.key !== 'about'),
        ...(references ? [{ key: 'references', title: 'References', content: references }] : []),
        { key: 'about', title: 'About this report', content: buildAbout(cited.length === 0 ? 0 : readCount, formatReadDate()) },
      ]
    : cleaned;
  // While the lock is on the text still carries the writer's markers on purpose;
  // they are numbered before the report is saved and are not a presentation fault here.
  const readerFailures = (text: string): string[] =>
    // Markers still in place are not failures here: with the lock they become
    // numbers later, and without it `[Chunk N]` is the citation form the report
    // is saved with. Redrafting over either would rewrite the citations themselves.
    presentationFailures(text).filter((hit) => !(lockedPassages ? hit === 'passage marker' : hit === 'chunk marker'));
  let sectionsOut = withSystem;
  let markdown = sectionsToMarkdown(sectionsOut, layer1 ? acceptedTitle || undefined : undefined);
  if (baselineLayerEnabled() && args.isAdjudicative !== true && readerFailures(markdown).length > 0) {
    const redraft = await callRoleModel({
      role: 'coherence_refiner',
      ...v2,
      baselineLayer: true,
      messages: [
        { role: 'system', content: 'Rewrite the report in plain encyclopedia prose. Remove grade labels and courtroom wording. Do not use the words claim or claims for what a source or the report says, and do not name a research step or reviewer. Keep every section heading. Do not add facts.' },
        { role: 'user', content: markdown },
      ],
    });
    modelCalls.push(redraft);
    const redrafted = parseRewrittenSections(redraft.content, sectionsOut);
    const parsed = redrafted && lockedPassages ? keepRewritesThatPreserveMarkers(sectionsOut, redrafted, { allowRemoval: true }) : redrafted;
    sectionsOut = parsed ?? sectionsOut;
    // A redraft can fail to parse, or come back with a section put back as it
    // was because the rewrite moved a citation. Either way a section can still
    // carry what the redraft was for. The words are taken out of any section
    // that still fails; citations stay where they are. Only prose is touched:
    // code and link destinations are left exactly as written, as the check
    // that found the wording never read them.
    sectionsOut = sectionsOut.map((section) =>
      readerFailures(`${section.title}\n\n${section.content}`).length > 0 ? { ...section, content: removeBannedWording(section.content) } : section
    );
  }
  if (layer1) {
    sectionsOut = sectionsOut.map((section) => ({ ...section, content: stripMachineFiller(section.content) }));
    markdown = sectionsToMarkdown(sectionsOut, acceptedTitle || undefined);
  }

  return {
    markdown,
    sections: sectionsOut,
    outline: resolvedOutline,
    targetWordCount,
    // Item headings as actually composed by this pipeline. The auditor matches
    // these exactly; nothing is inferred from the model's prose.
    plannedItemTitles: new Set(resolvedItemTitles),
    refinedSectionCount: refinedBodies.size,
    modelCalls,
    citationIssues,
  };
}
