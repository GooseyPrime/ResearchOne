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

export interface SectionPlanEntry {
  title: string;
  key: string;
  weight: number;
}

/** Artifact shape we care about, kept structural to avoid importing the brief. */
export interface ContractArtifact {
  type?: string;
  description?: string;
  exactCount?: number;
  explicitRequiredFields?: readonly string[];
  inferredRequiredFields?: readonly string[];
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
}): ExpandOutlineResult {
  const base = args.basePlan.map((entry) => ({ ...entry }));
  const artifact = findRepeatedArtifact(args.artifacts);

  if (!artifact || typeof artifact.exactCount !== 'number') {
    return {
      plan: base,
      expanded: false,
      itemCount: 0,
      itemsPerSection: 0,
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
      reason: `Intent plan has no list section to expand; ${count} items must be produced within the existing sections.`,
    };
  }

  const listEntry = base[listIndex]!;
  const sectionCount = Math.min(count, MAX_EXPANDED_SECTIONS);
  const itemsPerSection = Math.ceil(count / sectionCount);
  const label = (artifact.type || 'Item').replace(/_/g, ' ').trim() || 'Item';
  const titleWord = label.charAt(0).toUpperCase() + label.slice(1);

  const expandedEntries: SectionPlanEntry[] = [];
  for (let section = 0; section < sectionCount; section += 1) {
    const first = section * itemsPerSection + 1;
    const last = Math.min(count, first + itemsPerSection - 1);
    if (first > count) break;
    const title = first === last ? `${titleWord} ${first}` : `${titleWord}s ${first}–${last}`;
    expandedEntries.push({
      title,
      key: `${slugify(listEntry.key)}_${first}${first === last ? '' : `_${last}`}`,
      // Each item carries the original list weight, so the total budget grows
      // with the contract instead of being divided into uselessly small slices.
      weight: listEntry.weight,
    });
  }

  const plan = [...base.slice(0, listIndex), ...expandedEntries, ...base.slice(listIndex + 1)];

  return {
    plan,
    expanded: true,
    itemCount: count,
    itemsPerSection,
    reason:
      itemsPerSection === 1
        ? `Expanded "${listEntry.title}" into ${expandedEntries.length} sections, one per requested ${label}.`
        : `Expanded "${listEntry.title}" into ${expandedEntries.length} sections covering ${count} ${label}s (${itemsPerSection} per section, capped at ${MAX_EXPANDED_SECTIONS}).`,
  };
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
