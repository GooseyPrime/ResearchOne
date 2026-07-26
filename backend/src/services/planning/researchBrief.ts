/**
 * Phase B — ResearchBrief: the structured representation of what the user
 * actually requested, extracted by the classifier and threaded through the
 * pipeline to anchor plan generation, synthesis, verification, and the
 * final Deliverable Contract Auditor.
 */
import type { IntentId } from './intentTaxonomy';

/**
 * Epistemic posture determines which pipeline tools are activated.
 * - descriptive: explain / survey / how-to / factual lookup
 * - decision: recommend / compare / rank
 * - discovery: opportunity / market / whitespace
 * - adjudicative: fact-check / story verification / claim audit
 * - causal_test: hypothesis test / investigation (full adversarial pipeline)
 */
export type EpistemicPosture =
  | 'descriptive'
  | 'decision'
  | 'discovery'
  | 'adjudicative'
  | 'causal_test';

/** An artifact the user explicitly asked for (e.g. "list of ten opportunities"). */
export interface RequestedArtifact {
  /** Human-readable description of the artifact, e.g. "ranked list of market opportunities". */
  description: string;
  /** Exact count the user stated, if any (e.g. "ten opportunities" → count 10). */
  exactCount?: number;
  /** Required subfields per list item, if the user specified them. */
  requiredFields?: string[];
}

/** A constraint the user stated that must not be violated by the report. */
export interface UserConstraint {
  description: string;
}

/**
 * The structured output of the intent classifier (Phase B+).
 *
 * Replaces the simple `{ intent, confidence, reasoning }` triple with a richer
 * contract that drives planning, synthesis, verification, and the contract
 * auditor.
 */
export interface ResearchBrief {
  primaryIntent: IntentId;
  /** Optional secondary intent when the request is composite (e.g., discovery + implementation). */
  secondaryIntent?: IntentId;
  /** The deliverables the user asked for, extracted verbatim from the query. */
  requestedArtifacts: RequestedArtifact[];
  /** Hard constraints the report must satisfy (e.g., "build in 24 hours", "use Stripe"). */
  userConstraints: UserConstraint[];
  /** The epistemic posture that governs which pipeline agents activate. */
  epistemicPosture: EpistemicPosture;
  /** 0–1 classifier confidence for the primary intent. */
  confidence: number;
  /** Short explanation of why this brief was extracted. */
  reasoning: string;
}

/** Map from IntentId to its natural epistemic posture (used as fallback when LLM omits it). */
export const INTENT_EPISTEMIC_POSTURE: Record<IntentId, EpistemicPosture> = {
  factual_report: 'descriptive',
  survey: 'descriptive',
  adjudication: 'adjudicative',
  investigation: 'causal_test',
  story_verification: 'adjudicative',
  opportunity_discovery: 'discovery',
  feasibility: 'decision',
  implementation: 'descriptive',
  literature_review: 'descriptive',
  comparative: 'decision',
  how_to: 'descriptive',
  recommendation: 'decision',
  exploratory: 'discovery',
  position_brief: 'adjudicative',
  timeline: 'descriptive',
  reference_lookup: 'descriptive',
  legacy: 'descriptive',
};

/** Return a safe default ResearchBrief when the classifier fails. */
export function defaultResearchBrief(
  intent: IntentId,
  confidence: number,
  reasoning: string
): ResearchBrief {
  return {
    primaryIntent: intent,
    secondaryIntent: undefined,
    requestedArtifacts: [],
    userConstraints: [],
    epistemicPosture: INTENT_EPISTEMIC_POSTURE[intent] ?? 'descriptive',
    confidence,
    reasoning,
  };
}

/** Format the ResearchBrief as a compact context block for LLM prompts. */
export function formatBriefForPrompt(brief: ResearchBrief): string {
  const lines: string[] = [
    `PRIMARY_INTENT: ${brief.primaryIntent}`,
    brief.secondaryIntent ? `SECONDARY_INTENT: ${brief.secondaryIntent}` : '',
    `EPISTEMIC_POSTURE: ${brief.epistemicPosture}`,
    `CONFIDENCE: ${brief.confidence.toFixed(2)}`,
  ];
  if (brief.requestedArtifacts.length > 0) {
    lines.push(`REQUESTED_ARTIFACTS:`);
    for (const a of brief.requestedArtifacts) {
      const countNote = a.exactCount != null ? ` [exact count: ${a.exactCount}]` : '';
      const fieldsNote =
        a.requiredFields && a.requiredFields.length > 0
          ? ` [required fields: ${a.requiredFields.join(', ')}]`
          : '';
      lines.push(`  - ${a.description}${countNote}${fieldsNote}`);
    }
  }
  if (brief.userConstraints.length > 0) {
    lines.push(`USER_CONSTRAINTS:`);
    for (const c of brief.userConstraints) {
      lines.push(`  - ${c.description}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}
