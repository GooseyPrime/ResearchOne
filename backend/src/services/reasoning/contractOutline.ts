/**
 * Contract-driven outline expansion (WO-AC R1/R2).
 *
 * The failure this fixes: run `e5aac059` requested 20 opportunities, each with
 * five mandated subsections, plus a seven-part winner blueprint — roughly 107
 * required blocks. `intent_opportunity_discovery` declares FIVE fixed sections.
 * The drafter wrote what fit into those five and stopped, delivering 8/20 with
 * no per-item detail and no blueprint.
 *
 * Section plans are per-INTENT; deliverable contracts are per-REQUEST. Rule 37
 * R-5 and R-B already make counts and required fields brief-derived. The
 * outline has to follow, or the contract is unsatisfiable by construction.
 *
 * This module expands a static plan into one section per requested artifact
 * when the brief asks for a repeated, structured deliverable — which also makes
 * each item independently draftable and independently repairable (R3).
 */
import { getIntentOutputTemplate } from '../formatting/templates/intentOutputTemplates';

export interface SectionPlanEntry {
  title: string;
  key: string;
  weight: number;
  /**
   * First item number this section covers, when it is one of the per-item
   * sections created by expansion. Absent on framing sections.
   *
   * Carrying the ordinal as DATA is what lets code compose the heading. The
   * previous design encoded it in the title string and then tried to parse it
   * back out of whatever the model wrote, which is where the delivered-item
   * count was lost (run `c50162a9`).
   */
  itemOrdinal?: number;
  /** Last item number, when one section covers a range (cap forced grouping). */
  itemLastOrdinal?: number;
}

/**
 * Artifact shape we care about, kept structural to avoid importing the brief.
 *
 * NOTE: production `RequestedArtifact` has `description` and NO `type`. Nothing
 * user-visible may be derived from `type` — doing so produced "## Item 1" on
 * every real run (Codex review, PR #205). Section labels no longer come from
 * this shape at all; they come from the report type.
 */
export interface ContractArtifact {
  description?: string;
  /** Not present on production briefs; accepted only for forward-compat. */
  type?: string;
  exactCount?: number;
  explicitRequiredFields?: readonly string[];
  inferredRequiredFields?: readonly string[];
}

/**
 * Fallback label for one repeated item, owned by the REPORT TYPE.
 *
 * This used to guess the label out of the brief's prose — strip noise words,
 * take the last noun-ish token, singularise. That is unfixable in principle:
 * natural language has no reliable "the thing being enumerated" position, and
 * every miss produced a new special case. Run `c50162a9` planned
 * "Modeling 1..20" for a list of market opportunities because the request
 * happened to end in a gerund; patching that with a gerund rule then surfaced
 * an adjective ("Financial"), and so on.
 *
 * The report type is a known, closed set that the pipeline already routes on
 * (Rule 37). It carries the label. `intentOutputTemplates` is the single place
 * a new report type declares its vocabulary.
 *
 * This is only a FALLBACK: the drafter supplies each item's concrete name, so
 * a finished heading reads "7. Home Fitness Equipment", not "7. Opportunity".
 */
export function deriveItemLabel(_artifact: ContractArtifact | null, intentId?: string): string {
  return getIntentOutputTemplate(`intent_${intentId ?? 'legacy'}`).itemLabel;
}

/**
 * Expanding beyond this many sections costs more than it buys: each section is
 * a model call, and past ~40 the per-item budget is too small to be useful.
 * Above the cap we group items so every item still gets drafted.
 */
export const MAX_EXPANDED_SECTIONS = 40;

/** Below this, per-item expansion is not worth the extra calls. */
export const MIN_COUNT_FOR_EXPANSION = 3;

/** Section keys that represent "the list of requested items". */
const LIST_SECTION_KEYS = new Set([
  'opportunities_list',
  'options',
  'per_option',
  'findings',
  'highlights',
  'plan_phases',
  'detailed_steps',
  'steps',
]);

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'item';
}

/**
 * Pick the artifact that represents the repeated deliverable: the one with an
 * exact count and required fields.
 */
export function findRepeatedArtifact(
  artifacts: readonly ContractArtifact[] | undefined
): ContractArtifact | null {
  if (!artifacts || artifacts.length === 0) return null;
  const withCount = artifacts.filter(
    (a) => typeof a.exactCount === 'number' && (a.exactCount ?? 0) >= MIN_COUNT_FOR_EXPANSION
  );
  if (withCount.length === 0) return null;
  // Prefer the artifact carrying the most required fields — that is the one
  // whose per-item structure the user actually specified.
  return withCount.sort(
    (a, b) =>
      (b.explicitRequiredFields?.length ?? 0) + (b.inferredRequiredFields?.length ?? 0) -
      ((a.explicitRequiredFields?.length ?? 0) + (a.inferredRequiredFields?.length ?? 0))
  )[0] ?? null;
}

export interface ExpandOutlineResult {
  plan: SectionPlanEntry[];
  /** True when expansion actually changed the plan. */
  expanded: boolean;
  /** Number of requested items the plan now covers. */
  itemCount: number;
  /** Items drafted per expanded section (1 unless the cap forced grouping). */
  itemsPerSection: number;
  /**
   * Titles of the sections this expansion created, lowercased.
   *
   * The contract auditor uses these to recognise a delivered item by the title
   * that was actually planned. Without them it falls back to a label regex the
   * drafter never agreed to follow, and scores a fully delivered report as zero
   * (run `c50162a9`: planned "Modeling 1..20", drafted "## 1. Developer Tools").
   */
  expandedTitles: readonly string[];
  reason: string;
}

/**
 * Expand a static section plan so the requested items each get their own
 * drafting slot.
 *
 * The list section is replaced in place, preserving surrounding sections
 * (overview before, analysis/recommendations after) so narrative order holds.
 */
export function expandSectionPlanForContract(args: {
  basePlan: readonly SectionPlanEntry[];
  artifacts?: readonly ContractArtifact[];
  intentId?: string;
  /**
   * The user's explicit word target, if any. Expansion must not silently
   * override it: N sections each pinned to the per-section floor can exceed a
   * short explicit budget, producing contradictory whole-report vs
   * section-length instructions (Codex review, PR #205).
   */
  explicitWordTarget?: number;
  /** Per-section word floor used by the budget distributor. */
  perSectionFloor?: number;
}): ExpandOutlineResult {
  const base = args.basePlan.map((entry) => ({ ...entry }));
  const artifact = findRepeatedArtifact(args.artifacts);

  if (!artifact || typeof artifact.exactCount !== 'number') {
    return {
      plan: base,
      expanded: false,
      itemCount: 0,
      itemsPerSection: 0,
      expandedTitles: [],
      reason: 'No repeated artifact with an exact count; using the intent section plan unchanged.',
    };
  }

  const count = artifact.exactCount;
  const listIndex = base.findIndex((entry) => LIST_SECTION_KEYS.has(entry.key));
  if (listIndex === -1) {
    return {
      plan: base,
      expanded: false,
      itemCount: count,
      itemsPerSection: 0,
      expandedTitles: [],
      reason: `Intent plan has no list section to expand; ${count} items must be produced within the existing sections.`,
    };
  }

  const listEntry = base[listIndex]!;

  // Respect an explicit word target: N sections each pinned to the per-section
  // floor cannot fit inside a short budget. Cap the section count so the
  // expanded plan still fits what the user asked for.
  const floor = args.perSectionFloor ?? 80;
  const otherSections = base.length - 1;
  let budgetCap = MAX_EXPANDED_SECTIONS;
  if (typeof args.explicitWordTarget === 'number' && args.explicitWordTarget > 0) {
    const affordable = Math.floor(args.explicitWordTarget / floor) - otherSections;
    budgetCap = Math.max(1, Math.min(MAX_EXPANDED_SECTIONS, affordable));
  }

  const sectionCount = Math.max(1, Math.min(count, budgetCap));
  const itemsPerSection = Math.ceil(count / sectionCount);
  const titleWord = deriveItemLabel(artifact, args.intentId);

  const expandedEntries: SectionPlanEntry[] = [];
  for (let section = 0; section < sectionCount; section += 1) {
    const first = section * itemsPerSection + 1;
    const last = Math.min(count, first + itemsPerSection - 1);
    if (first > count) break;
    // Provisional title only. The final heading is composed after drafting,
    // from this ordinal plus the concrete item name the drafter supplies, so a
    // heading is never parsed back out of model prose.
    const title = first === last ? `${first}. ${titleWord}` : `${first}–${last}. ${titleWord}s`;
    expandedEntries.push({
      title,
      key: `${slugify(listEntry.key)}_${first}${first === last ? '' : `_${last}`}`,
      // Each item carries the original list weight, so the total budget grows
      // with the contract instead of being divided into uselessly small slices.
      weight: listEntry.weight,
      itemOrdinal: first,
      ...(first === last ? {} : { itemLastOrdinal: last }),
    });
  }

  const plan = [...base.slice(0, listIndex), ...expandedEntries, ...base.slice(listIndex + 1)];

  return {
    plan,
    expanded: true,
    itemCount: count,
    itemsPerSection,
    expandedTitles: expandedEntries.map((entry) => entry.title.toLowerCase()),
    reason:
      itemsPerSection === 1
        ? `Expanded "${listEntry.title}" into ${expandedEntries.length} sections, one per requested ${titleWord.toLowerCase()}.`
        : `Expanded "${listEntry.title}" into ${expandedEntries.length} sections covering ${count} ${titleWord.toLowerCase()}s (${itemsPerSection} per section, cap ${budgetCap}).`,
  };
}

/**
 * Section plans are per-INTENT and generic ("Ranking and Analysis",
 * "Recommendations", "Caveats"). A brief that also asks for a Cross-Opportunity
 * Analysis and a Final Winner names deliverables no static plan contains, so
 * the drafter is never given a slot to write them, the auditor then reports
 * them missing, and repair has to bolt them on afterwards.
 *
 * Run `c50162a9` failed on exactly this: 20/20 items delivered, two named
 * trailing deliverables absent, two repair passes spent chasing them.
 *
 * Beyond this many appended sections the brief is better served by the
 * intent plan than by one section per phrase.
 */
export const MAX_CONTRACT_SECTIONS = 8;

/** Words too generic to prove that an existing section already covers an artifact. */
const COVERAGE_STOPWORDS = new Set([
  'a', 'an', 'the', 'of', 'for', 'and', 'or', 'with', 'to', 'in', 'on', 'by', 'per', 'each',
  'provide', 'create', 'generate', 'deliver', 'include', 'list', 'section', 'report', 'analysis',
  'detailed', 'complete', 'full', 'summary', 'overview', 'final', 'all', 'that', 'which',
]);

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 2 && !COVERAGE_STOPWORDS.has(word));
}

/** Turn an artifact description into a section heading. */
export function deriveContractSectionTitle(description: string): string | null {
  const cleaned = (description ?? '')
    .replace(/^(?:provide|create|generate|deliver|include|produce|outline|write)\s+/i, '')
    .replace(/^(?:a|an|the)\s+/i, '')
    .replace(/\s+/g, ' ')
    .replace(/[.:;,]+$/, '')
    .trim();
  if (cleaned.length < 4 || cleaned.length > 80) return null;
  // A phrase with a verb in the middle is an instruction, not a heading.
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Add a drafting slot for every named deliverable the intent plan does not
 * already cover.
 *
 * Inserted before the plan's trailing caveats/limitations section so the report
 * still ends on its framing, and skipped entirely when an existing section
 * already covers the same ground.
 */
export function appendContractRequiredSections(args: {
  plan: readonly SectionPlanEntry[];
  artifacts?: readonly ContractArtifact[];
  /** The repeated artifact, which already has its own expanded sections. */
  repeatedArtifact?: ContractArtifact | null;
  /** Section keys that must stay last (caveats, limitations, sources). */
  trailingKeys?: ReadonlySet<string>;
}): { plan: SectionPlanEntry[]; added: string[] } {
  const plan = args.plan.map((entry) => ({ ...entry }));
  const added: string[] = [];
  if (!args.artifacts || args.artifacts.length === 0) return { plan, added };

  const trailingKeys = args.trailingKeys ?? new Set(['caveats', 'limitations', 'sources', 'appendix']);
  const existingKeys = new Set(plan.map((entry) => entry.key));
  const existingTitleWords = plan.map((entry) => new Set(significantWords(entry.title)));
  const averageWeight =
    plan.length > 0 ? plan.reduce((sum, entry) => sum + entry.weight, 0) / plan.length : 1;

  const pending: SectionPlanEntry[] = [];
  for (const artifact of args.artifacts) {
    if (artifact === args.repeatedArtifact) continue;
    // Counted artifacts are the repeated deliverable; they get item sections.
    if (typeof artifact.exactCount === 'number' && artifact.exactCount >= MIN_COUNT_FOR_EXPANSION) continue;
    const title = deriveContractSectionTitle(artifact.description ?? '');
    if (!title) continue;

    const words = significantWords(title);
    if (words.length === 0) continue;
    // Covered when every meaningful word of the deliverable already appears in
    // some section title — that section is where the drafter will write it.
    const covered = existingTitleWords.some((titleWords) => words.every((word) => titleWords.has(word)));
    if (covered) continue;

    const key = `contract_${slugify(title)}`;
    if (existingKeys.has(key)) continue;
    existingKeys.add(key);
    pending.push({ title, key, weight: averageWeight });
    added.push(title);
    if (pending.length >= MAX_CONTRACT_SECTIONS) break;
  }

  if (pending.length === 0) return { plan, added };

  let insertAt = plan.length;
  for (let i = plan.length - 1; i >= 0; i -= 1) {
    if (trailingKeys.has(plan[i]!.key)) insertAt = i;
    else break;
  }
  plan.splice(insertAt, 0, ...pending);
  return { plan, added };
}

/**
 * Derive a word target from the contract instead of a fixed default (R2).
 *
 * A 107-block deliverable cannot share a default budget with a four-section
 * explainer. Returns `null` when the caller's explicit target should win.
 */
export function deriveContractWordTarget(args: {
  explicitTarget?: number;
  itemCount: number;
  requiredFieldsPerItem: number;
  baselineWords: number;
  /** Words allotted per required field on an item. */
  wordsPerField?: number;
  /** Words allotted per item before fields. */
  wordsPerItem?: number;
}): number | null {
  // An explicit user target always wins — never silently override a stated
  // length preference.
  if (typeof args.explicitTarget === 'number' && args.explicitTarget > 0) return null;
  if (args.itemCount < MIN_COUNT_FOR_EXPANSION) return null;

  const wordsPerItem = args.wordsPerItem ?? 120;
  const wordsPerField = args.wordsPerField ?? 45;
  const contractWords =
    args.itemCount * (wordsPerItem + args.requiredFieldsPerItem * wordsPerField);

  // Never shrink below the baseline; only grow to fit the contract.
  return Math.max(args.baselineWords, args.baselineWords + contractWords);
}
