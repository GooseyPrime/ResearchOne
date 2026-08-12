/**
 * Epistemic transparency content — Phase 2.
 * Plain-language explanations of how ResearchOne approaches research.
 * Used by PlanConfirmationPanel, MethodologyPage, GuidePage, OnboardingPage, and marketing.
 * Canonical companion: docs/HOW_RESEARCHONE_RESEARCHES.md
 */

// ---------------------------------------------------------------------------
// Plan gate short copy
// ---------------------------------------------------------------------------

export const HOW_RESEARCHONE_THINKS_SHORT =
  'ResearchOne routes every query through an intent classifier, picks a research posture ' +
  '(neutral, challenge, or Formulation enhancement), then runs a multi-agent pipeline: Planning → Discovery → ' +
  'Retrieval → Reasoning → optional Challenge → Synthesis → Verification. Source disagreements stay ' +
  'visible, never silently flattened. For investigation and verification paths, the system gathers ' +
  'supporting and opposing evidence before finalizing the report.';

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
    heading: 'Intent routing',
    body:
      'Before planning starts, ResearchOne classifies your query into one of 16+ research intents — ' +
      'from encyclopedic fact retrieval to investigation or verification. The detected intent selects the ' +
      'orchestration profile: which specialist agents run, which are skipped, and what epistemic posture ' +
      'the pipeline adopts. You see the detected intent and its confidence at the plan gate and can ' +
      'redirect to a different intent if the classification missed the mark.',
  },
  {
    id: 'reasoning-first',
    heading: 'Reasoning-first pipeline',
    body:
      'Sources are retrieved and read before any reasoning is written. The reasoning agent then drafts ' +
      'findings grounded in those sources, with a citation for every claim. A separate challenge step ' +
      '(skeptic agent) then argues against the draft — catching unsupported assertions, weak corroboration, ' +
      'and potential confirmation bias — before synthesis. This means conclusions go through an internal ' +
      'challenge review before you see them.',
  },
  {
    id: 'policyone',
    heading: 'Investigation and verification paths',
    body:
      'For investigation, adjudication, story-verification, and position-brief paths, the pipeline gathers ' +
      'supporting and opposing evidence and compares them side by side. The goal is a balanced account: ' +
      'the strongest case for and against, with relevant minority findings or alternative interpretations ' +
      'included when they matter to the research goal.',
  },
  {
    id: 'contradiction-preservation',
    heading: 'Source disagreements stay visible',
    body:
      'When sources genuinely disagree, ResearchOne preserves that disagreement in a source-disagreement ledger. ' +
      'Conflicting claims survive into the final report with full source attribution and severity levels. ' +
      'The system never silently rewrites, smooths, or collapses genuine conflict into a false consensus. ' +
      'You can inspect every preserved disagreement and its supporting sources.',
  },
];

// ---------------------------------------------------------------------------
// Outlier-bridging copy
// ---------------------------------------------------------------------------

export const OUTLIER_BRIDGING_MARKETING =
  'On investigation paths, ResearchOne includes relevant minority findings, contested data, and alternative ' +
  'interpretations when they matter to the question—so you can see the full evidential landscape, not just ' +
  'the easiest summary.';

export const OUTLIER_BRIDGING_ONE_LINER =
  'When investigation is the goal, we keep relevant minority findings and alternative interpretations in view—without forcing every question into a challenge workflow.';

// ---------------------------------------------------------------------------
// Posture families
// ---------------------------------------------------------------------------

export type PostureFamilyId = 'neutral' | 'challenge' | 'steelman';

export interface PostureFamily {
  id: PostureFamilyId;
  label: string;
  shortDescription: string;
  badgeClass: string;
}

export const POSTURE_FAMILIES: readonly PostureFamily[] = [
  {
    id: 'neutral',
    label: 'Neutral',
    shortDescription:
      'Encyclopedic or survey posture. The pipeline retrieves, synthesizes, and verifies without a dedicated challenge step. Best for factual reports, how-to guides, and reference lookups.',
    badgeClass: 'text-slate-300 border-slate-600',
  },
  {
    id: 'challenge',
    label: 'Challenge',
    shortDescription:
      'Skeptic posture. A dedicated challenge step argues against draft conclusions before synthesis. Catches weak corroboration and confirmation bias. Used for adjudication, investigation, and story-verification paths.',
    badgeClass: 'text-rose-300 border-rose-700/50',
  },
  {
    id: 'steelman',
    label: 'Formulation enhancement',
    shortDescription:
      'Position-brief posture. The pipeline constructs the strongest possible case for a stated position or builds symmetric best-case arguments for multiple options. Used for position briefs and comparative briefs.',
    badgeClass: 'text-violet-300 border-violet-700/50',
  },
];

/**
 * Resolve which posture family applies given raw orchestration values.
 * Mirrors the backend profile selection heuristic at display layer.
 */
export function resolvePostureFamily({
  skepticMode,
  steelmanMode,
  intentId,
}: {
  skepticMode: string;
  steelmanMode: string;
  intentId: string;
}): PostureFamily {
  // "steelmanMode" is used by multiple intents (often "standard"), but the *posture family*
  // should only be Steelman for explicit position-brief style runs.
  if (intentId === 'position_brief' || steelmanMode === 'as_product') {
    return POSTURE_FAMILIES.find((p) => p.id === 'steelman')!;
  }

  // "challenge" posture corresponds to a skeptic gate (not sidebar-only annotations).
  if (skepticMode === 'gate') {
    return POSTURE_FAMILIES.find((p) => p.id === 'challenge')!;
  }
  return POSTURE_FAMILIES.find((p) => p.id === 'neutral')!;
}

// ---------------------------------------------------------------------------
// Intent help text (plan gate tooltips / inline help)
// ---------------------------------------------------------------------------

export const INTENT_HELP_TEXT: Record<string, string> = {
  factual_report:
    'Closed-record encyclopedic answer. The pipeline retrieves established sources and synthesizes a factual summary. No dedicated challenge step.',
  survey:
    'Layered exposition across multiple sub-topics or viewpoints. Neutral posture; the pipeline maps the terrain rather than adjudicating claims.',
  adjudication:
    'Fact-check a specific claim or proposition. Challenge posture: the pipeline argues for and against the claim before delivering a verdict with evidence.',
  investigation:
    'Symmetric deep-dive on a complex topic. Challenge posture with supporting and opposing evidence gathered side by side.',
  story_verification:
    'Verify a specific narrative or reported account claim-by-claim. Challenge posture with source disagreements kept visible.',
  opportunity_discovery:
    'Surface under-served problems, market gaps, or domain opportunities. Neutral-to-survey posture focused on pattern recognition.',
  feasibility:
    'Assess whether a plan, idea, or initiative is viable given constraints. Balanced posture that surfaces both supporting and blocking evidence.',
  implementation:
    'Step-by-step evidence-based execution plan. Neutral posture focused on practical sequencing and source-grounded steps.',
  literature_review:
    'Academic-register synthesis of peer-reviewed sources. Neutral posture; citation quality and recency weighted heavily.',
  comparative:
    'Structured comparison across options along consistent dimensions. Challenge posture: a skeptic gate critiques each option before synthesis.',
  how_to:
    'Procedural guide answering "how do I…" questions. Lightweight neutral posture focused on actionable steps.',
  recommendation:
    'Decision support with elicited constraints. Challenge posture: the draft recommendation is critiqued before synthesis to surface weak assumptions.',
  exploratory:
    'Discovery and serendipity mode. Broad neutral retrieval to map unknown territory before committing to a direction.',
  position_brief:
    'Rhetorical aid: strongest case for a stated position. Formulation enhancement posture — the pipeline builds the most compelling argument, then offers symmetric counter-case.',
  timeline:
    'Chronological ordering of events. Challenge posture: the pipeline cross-checks for inconsistencies and weak sourcing before synthesis.',
  reference_lookup:
    'Single-fact or single-definition retrieval. Lightest pipeline — fast neutral retrieval, no challenge step.',
  legacy:
    'Pre-taxonomy run; intent inferred conservatively. Challenge posture with a skeptic gate before synthesis.',
};

// ---------------------------------------------------------------------------
// Intent override control
// ---------------------------------------------------------------------------

export interface IntentOverrideOption {
  id: string;
  label: string;
  shortDescription: string;
}

/** Ordered list for the "I meant a different research goal" select. */
export const INTENT_OVERRIDE_OPTIONS: readonly IntentOverrideOption[] = [
  { id: 'factual_report', label: 'Factual report', shortDescription: 'Encyclopedic answer for a closed-record topic.' },
  { id: 'survey', label: 'Survey', shortDescription: 'Layered overview of a broad topic.' },
  { id: 'adjudication', label: 'Adjudication / fact-check', shortDescription: 'Verify a specific claim or proposition.' },
  { id: 'investigation', label: 'Investigation', shortDescription: 'Symmetric deep-dive on a contested topic.' },
  { id: 'story_verification', label: 'Story verification', shortDescription: 'Verify a specific narrative account.' },
  { id: 'opportunity_discovery', label: 'Opportunity discovery', shortDescription: 'Surface market or domain opportunities.' },
  { id: 'feasibility', label: 'Feasibility', shortDescription: 'Assess viability of a plan or idea.' },
  { id: 'implementation', label: 'Implementation plan', shortDescription: 'Step-by-step evidence-based execution plan.' },
  { id: 'literature_review', label: 'Literature review', shortDescription: 'Academic synthesis of peer-reviewed sources.' },
  { id: 'comparative', label: 'Comparative analysis', shortDescription: 'Structured comparison across options.' },
  { id: 'how_to', label: 'How-to guide', shortDescription: 'Procedural step-by-step guide.' },
  { id: 'recommendation', label: 'Recommendation', shortDescription: 'Decision support with trade-off analysis.' },
  { id: 'exploratory', label: 'Exploratory', shortDescription: 'Broad discovery of an unknown territory.' },
  { id: 'position_brief', label: 'Position brief', shortDescription: 'Strongest case for a stated position.' },
  { id: 'timeline', label: 'Timeline', shortDescription: 'Chronological ordering of events.' },
  { id: 'reference_lookup', label: 'Reference lookup', shortDescription: 'Single-fact or definition retrieval.' },
];

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
  'ResearchOne uses an intent-aware multi-agent pipeline: it classifies your research goal, picks a ' +
  'research posture (neutral, challenge, or Formulation enhancement), and runs a reasoning-first pipeline that keeps ' +
  'source disagreements visible when they matter. You review and approve the plan before any retrieval runs.';
