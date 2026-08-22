import { callRoleModel, getSystemPrompt } from '../openrouter/openrouterService';
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
  if (!raw || raw.length > MAX_ITEM_NAME_CHARS) return { itemName: null, content };
  return { itemName: raw, content };
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
 */
export function parseRefinedSections(response: string): Map<string, string> {
  const out = new Map<string, string>();
  const text = response ?? '';
  SECTION_BLOCK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = SECTION_BLOCK_PATTERN.exec(text)) !== null) {
    const key = (match[1] ?? '').trim();
    const body = (match[2] ?? '').trim();
    if (!key || !body) continue;
    // A refiner that emits a heading anyway would otherwise leave it stranded
    // mid-section, since the real heading is prepended by the assembler.
    const withoutHeading = body.replace(/^##\s+[^\n]*\n+/, '').trim();
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
const GENERATED_TITLE_MAX_LENGTH = 120;

export function clampWordTarget(n: number | undefined): number {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return REPORT_WORD_COUNT_DEFAULT;
  return Math.max(REPORT_WORD_COUNT_MIN, Math.min(REPORT_WORD_COUNT_MAX, Math.round(n)));
}

export function deriveGeneratedReportTitle(query: string, markdown: string, intentId?: string): string {
  const headingMatch = markdown.match(/^\s*#\s+(.+?)\s*$/m);
  const firstHeading = headingMatch?.[1]?.trim();
  if (firstHeading && firstHeading.length <= GENERATED_TITLE_MAX_LENGTH && !looksLikeRawQuery(firstHeading, query)) {
    return firstHeading;
  }

  const firstSentence = markdown
    .replace(/^#+\s+/gm, '')
    .split(/\n+/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !looksLikeRawQuery(line, query));
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
  sectionPlan: Array<{ key: string; weight: number }> = ADJUDICATIVE_SECTION_PLAN
): Map<string, number> {
  const floor = REPORT_WORD_COUNT_PER_SECTION_FLOOR;
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

function formatLengthDirective(target: number, sectionTarget: number, sectionTitle: string): string {
  return [
    '',
    'LENGTH GUIDANCE — strict but substantive:',
    `- Whole report target: ~${target} words across all sections.`,
    `- This section ("${sectionTitle}") target: ~${sectionTarget} words (±15%).`,
    '- Use the budget on substance, not filler. Each paragraph must add a new fact, evidence chain, contradiction, or synthesis step.',
    '- If you run out of substantive material, STOP early — do not pad with restatements, generic caveats, or marketing language.',
    '- Cite specific evidence chunks and sources by their numbers/titles wherever you assert a claim.',
    '- Maintain epistemic precision: do not weaken claims with hedging that the evidence does not require, and do not overstate claims to fill space.',
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

function trimTitle(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= GENERATED_TITLE_MAX_LENGTH) return normalized;
  return normalized.slice(0, GENERATED_TITLE_MAX_LENGTH - 1).trimEnd() + '…';
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
  byokApiKeyOverride?: string;
  /** Intent ID from the orchestration profile. `undefined` (legacy runs)
   *  defaults to the full adjudicative section plan for backward
   *  compatibility. */
  intentId?: string;
  outputTemplateId?: string;
  onSectionProgress?: (payload: { title: string; index: number; total: number }) => void | Promise<void>;
  skipChallenger?: boolean;
  isAdjudicative?: boolean;
}): Promise<{
  markdown: string;
  sections: ReportSectionDraft[];
  outline: string[];
  targetWordCount: number;
  plannedItemTitles: ReadonlySet<string>;
  /** How many sections the refiner returned usably; the rest kept their draft. */
  refinedSectionCount: number;
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
  if (args.outputTemplateId) {
    const template = getIntentOutputTemplate(args.outputTemplateId);
    if (args.intentId && template.intentId !== args.intentId) {
      throw new Error(
        `INTENT_TEMPLATE_MISMATCH: intent=${args.intentId} template=${args.outputTemplateId} templateIntent=${template.intentId}`
      );
    }
    activeSectionPlan = sectionPlanFromTemplate(args.outputTemplateId);
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
    explicitWordTarget: args.targetWordCount,
    perSectionFloor: REPORT_WORD_COUNT_PER_SECTION_FLOOR,
  });
  activeSectionPlan = outlineExpansion.plan;

  const v2 = {
    engineVersion: args.engineVersion,
    researchObjective: args.researchObjective,
    allowFallbackByRole: args.allowFallbackByRole,
    byokApiKeyOverride: args.byokApiKeyOverride,
    isAdjudicative: args.isAdjudicative,
  };

  // WO-AC R2 — scale the word budget to the contract. A 107-block deliverable
  // must not share a default budget with a four-section explainer. An explicit
  // user target always wins.
  const repeatedArtifact = findRepeatedArtifact(args.contractArtifacts);
  const requiredFieldsPerItem =
    (repeatedArtifact?.explicitRequiredFields?.length ?? 0) +
    (repeatedArtifact?.inferredRequiredFields?.length ?? 0);
  const contractTarget = deriveContractWordTarget({
    explicitTarget: args.targetWordCount,
    itemCount: outlineExpansion.itemCount,
    requiredFieldsPerItem,
    baselineWords: clampWordTarget(undefined),
  });
  const targetWordCount = clampWordTarget(contractTarget ?? args.targetWordCount);
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
  const sectionBudgets = distributeWordBudget(targetWordCount, activeSectionPlan);
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
Return strict JSON only.`,
      },
    ],
  });

  modelCalls.push(outlineResponse);

  const outlinePayload = safeJsonParse<{ outline?: Array<{ title?: string }> }>(outlineResponse.content);
  const outline = (outlinePayload?.outline ?? [])
    .map((s) => (s.title || '').trim())
    .filter(Boolean);
  const resolvedOutline = outline.length > 0 ? outline : activeSectionPlan.map((s) => s.title);

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

    const sectionResult = await callRoleModel({
      role: 'section_drafter',
      ...v2,
      messages: [
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
Source material: ${args.sourceContext}
Rolling summary from previous sections: ${rollingSummary || 'none yet'}
${lengthDirective}
Return section body text only. Do NOT write a markdown heading for this section — the heading is added for you.`,
        },
      ],
    });

    modelCalls.push(sectionResult);

    // Headings are composed here, from the plan's ordinal, the report type's
    // label, and the drafter's declared item name. The model never authors one,
    // so the contract auditor matches exactly rather than pattern-matching prose.
    const { itemName, content: sectionText } = extractItemName(sectionResult.content.trim());
    const finalTitle =
      typeof section.itemOrdinal === 'number'
        ? composeItemHeading({
            ordinal: section.itemOrdinal,
            label: itemLabel,
            itemName,
            lastOrdinal: section.itemLastOrdinal,
          })
        : section.title;

    return { title: finalTitle, key: section.key, content: sectionText };
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

LENGTH GUIDANCE: keep the full report close to ~${targetWordCount} words. Tighten redundant phrasing but do not delete substantive findings, claims, or counterarguments. If a section is materially under its share of the budget, extend it with substantive analysis from the challenger findings rather than padding.`,
      },
    ],
  });

  // Reassemble from the drafted sections, substituting refined bodies where the
  // refiner returned a usable block. A section the refiner dropped, renamed, or
  // emptied keeps its drafted text — a coherence pass must never be able to
  // delete delivered work, and partial refinement beats discarding the report.
  modelCalls.push(challenger, refinement);

  const refinedBodies = parseRefinedSections(refinement.content);
  const finalSections: ReportSectionDraft[] = sections.map((section) => {
    const refined = refinedBodies.get(section.key);
    return refined ? { ...section, content: refined } : section;
  });

  return {
    markdown: finalSections.map((s) => `## ${s.title}\n${s.content}`).join('\n\n'),
    sections: finalSections,
    outline: resolvedOutline,
    targetWordCount,
    // Item headings as actually composed by this pipeline. The auditor matches
    // these exactly; nothing is inferred from the model's prose.
    plannedItemTitles: new Set(resolvedItemTitles),
    refinedSectionCount: refinedBodies.size,
    modelCalls,
  };
}
