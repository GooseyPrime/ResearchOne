/**
 * Epistemic transparency content — Phase 2.
 * Plain-language explanations of how ResearchOne approaches research.
 * Used by PlanConfirmationPanel, MethodologyPage, GuidePage, OnboardingPage, and marketing.
 */

// ---------------------------------------------------------------------------
// Plan gate short copy
// ---------------------------------------------------------------------------

export const HOW_RESEARCHONE_THINKS_SHORT =
  'ResearchOne routes every query through an intent classifier, picks an investigation posture ' +
  '(neutral, challenge, or steelman), then runs a multi-agent pipeline: plan → retrieve → reason → ' +
  'challenge (when warranted) → synthesize → verify. Contradictions between sources are preserved, ' +
  'never silently resolved. For investigation and adjudication paths, the system actively seeks ' +
  'supporting evidence for non-mainstream claims — it does not default to debunking.';

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
      'from encyclopedic fact retrieval to adversarial investigation. The detected intent selects the ' +
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
      'and potential confirmation bias — before synthesis. This means conclusions face internal adversarial ' +
      'pressure before you see them.',
  },
  {
    id: 'policyone',
    heading: 'PolicyOne stance',
    body:
      'PolicyOne governs investigation, adjudication, story-verification, and position-brief paths. ' +
      'On these paths the pipeline assumes that fringe or non-mainstream claims may contain truth and ' +
      'actively seeks supporting evidence rather than defaulting to consensus debunking. ' +
      'The goal is a symmetric account: the strongest case for and against, with outlier evidence surfaced ' +
      'and bridged to the mainstream cluster rather than discarded.',
  },
  {
    id: 'contradiction-preservation',
    heading: 'Contradiction preservation',
    body:
      'When sources genuinely disagree, ResearchOne preserves that disagreement in a contradiction ledger. ' +
      'Conflicting claims survive into the final report with full source attribution and severity levels. ' +
      'The system never silently rewrites, smooths, or collapses genuine conflict into a false consensus. ' +
      'You can inspect every preserved contradiction and its supporting sources.',
  },
];

// ---------------------------------------------------------------------------
// Outlier-bridging copy
// ---------------------------------------------------------------------------

export const OUTLIER_BRIDGING_MARKETING =
  'On investigation paths, ResearchOne does not stop at the consensus cluster. It actively bridges ' +
  'outlier evidence — minority findings, contested data, alternative interpretations — back into the ' +
  'main account so you see the full evidential landscape, not a curated majority view.';

export const OUTLIER_BRIDGING_ONE_LINER =
  'Outlier evidence bridged to consensus — not discarded.';

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
      'Encyclopedic or survey posture. The pipeline retrieves, synthesizes, and verifies without a dedicated adversarial challenge step. Best for factual reports, how-to guides, and reference lookups.',
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
    label: 'Steelman',
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
  // Steelman overrides skeptic when both are active
  if (
    steelmanMode !== 'off' ||
    intentId === 'position_brief'
  ) {
    return POSTURE_FAMILIES.find((p) => p.id === 'steelman')!;
  }
  if (
    skepticMode !== 'off' ||
    intentId === 'investigation' ||
    intentId === 'adjudication' ||
    intentId === 'story_verification'
  ) {
    return POSTURE_FAMILIES.find((p) => p.id === 'challenge')!;
  }
  return POSTURE_FAMILIES.find((p) => p.id === 'neutral')!;
}

// ---------------------------------------------------------------------------
// Intent help text (plan gate tooltips / inline help)
// ---------------------------------------------------------------------------

export const INTENT_HELP_TEXT: Record<string, string> = {
  factual_report:
    'Closed-record encyclopedic answer. The pipeline retrieves established sources and synthesizes a factual summary. No adversarial challenge step.',
  survey:
    'Layered exposition across multiple sub-topics or viewpoints. Neutral posture; the pipeline maps the terrain rather than adjudicating claims.',
  adjudication:
    'Fact-check a specific claim or proposition. Challenge posture: the pipeline argues for and against the claim before delivering a verdict with evidence.',
  investigation:
    'Symmetric deep-dive on a contested or complex topic. PolicyOne applies: outlier evidence is bridged, not discarded. Challenge posture.',
  story_verification:
    'Verify a specific narrative or reported account claim-by-claim. Challenge posture with contradiction preservation.',
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
    'Rhetorical aid: strongest case for a stated position. Steelman posture — the pipeline builds the most compelling argument, then offers symmetric counter-case.',
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
  'ResearchOne uses an intent-aware multi-agent pipeline: it classifies your research goal, picks an ' +
  'investigation posture (neutral, challenge, or steelman), and runs a reasoning-first pipeline that ' +
  'preserves contradictions and bridges outlier evidence — it does not force a consensus answer. ' +
  'You review and approve the plan before any retrieval runs.';
