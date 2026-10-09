/**
 * Plain-language explanations of how ResearchOne does its research.
 * Used by PlanConfirmationPanel, MethodologyPage, GuidePage, OnboardingPage, and marketing.
 * Canonical companion: docs/HOW_RESEARCHONE_RESEARCHES.md
 *
 * Names and descriptions of report types and of Double-check are read from the
 * registry of customer-facing names (`content/customerOptions.ts`), not written here.
 */
import { DOUBLE_CHECK, customerOptionHelp, customerOptionsIn } from './customerOptions';

// ---------------------------------------------------------------------------
// Plan gate short copy
// ---------------------------------------------------------------------------

export const HOW_RESEARCHONE_THINKS_SHORT =
  'ResearchOne first works out what kind of report you asked for, then runs these steps in order: ' +
  'planning, searching for sources, reading them, working through the evidence, Double-check, writing the report, ' +
  `and checking the report. ${DOUBLE_CHECK.description} Where sources disagree, the report shows the disagreement ` +
  'instead of hiding it.';

// ---------------------------------------------------------------------------
// Expandable methodology sections
// ---------------------------------------------------------------------------

export interface HowResearchOneThinksSection {
  id: string;
  heading: string;
  body: string;
}

export const HOW_RESEARCHONE_THINKS_SECTIONS: readonly HowResearchOneThinksSection[] = [
  {
    id: 'intent-routing',
    heading: 'Choosing the report type',
    body:
      'Before planning starts, ResearchOne reads your request and picks one of its report types — ' +
      'from a quick lookup of one fact to a full investigation or a fact-check. The report type decides ' +
      'which steps run and how the report is laid out. You see the report type, and how sure we are of it, ' +
      'on the plan screen, and you can change it there before anything runs.',
  },
  {
    id: 'reasoning-first',
    heading: 'Sources first, then Double-check',
    body:
      'Sources are found and read before any findings are written. The findings are then drafted from those ' +
      `sources, with a citation for every finding. ${DOUBLE_CHECK.description} ` +
      `Example: ${DOUBLE_CHECK.example} This happens before you see the report.`,
  },
  {
    id: 'policyone',
    heading: 'Investigations and fact-checks',
    body:
      'For an investigation, a fact-check, a story verification or a case for a position, ResearchOne gathers ' +
      'the evidence for and the evidence against and sets them side by side. The goal is a balanced account: ' +
      'the strongest case on each side, including less common findings and other explanations ' +
      'when they matter to your question.',
  },
  {
    id: 'contradiction-preservation',
    heading: 'Source disagreements stay visible',
    body:
      'When sources really do disagree, ResearchOne keeps a record of the disagreement. ' +
      'Both findings appear in the final report, each with its sources and a note on how serious the conflict is. ' +
      'The report never smooths a real conflict into false agreement. ' +
      'You can look at every recorded disagreement and the sources behind it.',
  },
];

// ---------------------------------------------------------------------------
// Outlier-bridging copy
// ---------------------------------------------------------------------------

export const OUTLIER_BRIDGING_MARKETING =
  'In an investigation, ResearchOne includes less common findings, disputed data and other ' +
  'explanations when they matter to the question — so you can see all of the evidence, not just ' +
  'the easiest summary.';

export const OUTLIER_BRIDGING_ONE_LINER =
  'In an investigation, we keep less common findings and other explanations in view — without turning every question into a dispute.';

// ---------------------------------------------------------------------------
// How findings are checked (plan screen and methodology page)
// ---------------------------------------------------------------------------

export type PostureFamilyId = 'neutral' | 'challenge' | 'strongest_form';

export interface PostureFamily {
  id: PostureFamilyId;
  label: string;
  shortDescription: string;
  badgeClass: string;
}

export const POSTURE_FAMILIES: readonly PostureFamily[] = [
  {
    id: 'neutral',
    label: 'Checked, with notes',
    shortDescription:
      'Double-check tests the findings and shows what it found as notes beside the report. Used for factual reports, how-to guides and lookups.',
    badgeClass: 'text-slate-300 border-slate-600',
  },
  {
    id: 'challenge',
    label: 'Checked before writing',
    shortDescription:
      'Double-check tests the findings first and the report is written from what stood up. Used for fact-checks, investigations and story verifications.',
    badgeClass: 'text-rose-300 border-rose-700/50',
  },
  {
    id: 'strongest_form',
    label: 'Strongest case',
    shortDescription:
      'The report makes the best-supported case for a position you named, then sets out the case against it. Used for a case for a position.',
    badgeClass: 'text-violet-300 border-violet-700/50',
  },
];

/**
 * Which of the three ways of checking applies, from the plan's own values.
 * Mirrors the backend's choice so the plan screen says the same thing.
 */
export function resolvePostureFamily({
  doubleCheckMode,
  strongestFormMode,
  intentId,
}: {
  doubleCheckMode: string;
  strongestFormMode: string;
  intentId: string;
}): PostureFamily {
  // Many report types restate findings before testing them; only a report whose
  // product is the strongest case belongs to the "Strongest case" family.
  if (intentId === 'position_brief' || strongestFormMode === 'as_product') {
    return POSTURE_FAMILIES.find((p) => p.id === 'strongest_form')!;
  }

  // The findings are tested before the report is written (not shown as notes only).
  if (doubleCheckMode === 'gate') {
    return POSTURE_FAMILIES.find((p) => p.id === 'challenge')!;
  }
  return POSTURE_FAMILIES.find((p) => p.id === 'neutral')!;
}

// ---------------------------------------------------------------------------
// Report types on the plan screen
// ---------------------------------------------------------------------------

/** What each report type does, with its example, by report-type id. */
export const INTENT_HELP_TEXT: Record<string, string> = Object.fromEntries(
  customerOptionsIn('report_type').map((option) => [option.id, customerOptionHelp(option)])
);

export interface IntentOverrideOption {
  id: string;
  label: string;
  shortDescription: string;
  example: string;
}

/** Report types a customer can switch to on the plan screen ("I meant a different report type"). */
export const INTENT_OVERRIDE_OPTIONS: readonly IntentOverrideOption[] = customerOptionsIn('report_type')
  .filter((option) => option.id !== 'legacy')
  .map((option) => ({ id: option.id, label: option.name, shortDescription: option.description, example: option.example }));

/**
 * Build the refine instruction to send to `refineRunPlanAtGate` when the user
 * selects a different intent at the plan gate.
 */
export function buildIntentOverrideRefineInstruction(
  targetIntentId: string,
  targetLabel: string,
): string {
  return (
    `Please re-route this research plan to the "${targetLabel}" intent (id: ${targetIntentId}). ` +
    `Update the orchestration profile, posture, and deliverables to match what a ${targetLabel.toLowerCase()} ` +
    `research goal requires. Preserve the original topic and any user-specified constraints.`
  );
}

// ---------------------------------------------------------------------------
// Onboarding teaser
// ---------------------------------------------------------------------------

export const ONBOARDING_HOW_IT_THINKS_TEASER =
  'ResearchOne works out what kind of report you asked for, finds and reads the sources, and writes findings ' +
  `from them. ${DOUBLE_CHECK.description} You review and approve the plan before any research runs.`;
