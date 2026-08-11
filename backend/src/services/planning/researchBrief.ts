/**
 * Phase B — ResearchBrief: the structured representation of what the user
 * actually requested, extracted by the classifier and threaded through the
 * pipeline to anchor plan generation, synthesis, verification, and the
 * final Deliverable Contract Auditor.
 */
import type { IntentId } from './intentTaxonomy';
import type { ResearchObjective } from '../reasoning/reasoningModelPolicy';

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
  /**
   * Fields the user explicitly named in their request (e.g. "include monetization and competition").
   * These are hard requirements — the plan and report must include them.
   */
  explicitRequiredFields?: string[];
  /**
   * Fields ResearchOne inferred are necessary to competently fulfill the request.
   * Shown at the plan gate and editable before confirmation.
   */
  inferredRequiredFields?: string[];
  /**
   * Fields ResearchOne can add if data is available but are not required for a passing report.
   */
  optionalFields?: string[];
  /**
   * @deprecated Prefer explicitRequiredFields / inferredRequiredFields.
   * Kept for backward compatibility with plans persisted before this change.
   */
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
  /** Requested methodology: 'auto' | 'standard' | 'policyone' */
  requestedMethodology: 'auto' | 'standard' | 'policyone';
  /** Resolved methodology after triage */
  resolvedMethodology: 'standard' | 'policyone';
  /** How methodology was resolved */
  methodologyResolutionSource: 'user' | 'triage' | 'fallback';
  /** Optional secondary intent when the request is composite (e.g., discovery + implementation). */
  secondaryIntent?: IntentId;
  /** The deliverables the user asked for, extracted verbatim from the query. */
  requestedArtifacts: RequestedArtifact[];
  /** Requested presentation formats e.g. ['narrative_briefing', 'ranked_options'] */
  requestedFormats?: string[];
  /** Hard constraints the report must satisfy (e.g., "build in 24 hours", "use Stripe"). */
  userConstraints: UserConstraint[];
  /** The epistemic posture that governs which pipeline agents activate. */
  epistemicPosture: EpistemicPosture;
  /** 0–1 classifier confidence for the primary intent. */
  confidence: number;
  /** Short explanation of why this brief was extracted. */
  reasoning: string;
  /** Requested research objective: 'AUTO' or a ResearchObjective */
  requestedResearchObjective?: 'AUTO' | ResearchObjective;
  /** Resolved research objective */
  resolvedResearchObjective?: ResearchObjective;
  /** How objective was resolved */
  objectiveResolutionSource?: 'user' | 'triage' | 'fallback';
  /** Why this objective was selected */
  objectiveResolutionReason?: string;
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


export function resolveMethodologyFromIntent(intent: IntentId): 'standard' | 'policyone' {
  switch (intent) {
    case 'adjudication':
    case 'investigation':
    case 'story_verification':
      return 'policyone';
    default:
      return 'standard';
  }
}

export function resolveObjectiveFromIntent(intent: IntentId): ResearchObjective {
  switch (intent) {
    case 'opportunity_discovery':
    case 'exploratory':
      return 'NOVEL_APPLICATION_DISCOVERY';
    case 'investigation':
    case 'story_verification':
    case 'adjudication':
      return 'INVESTIGATIVE_SYNTHESIS';
    case 'comparative':
    case 'recommendation':
      return 'GENERAL_EPISTEMIC_RESEARCH';
    default:
      return 'GENERAL_EPISTEMIC_RESEARCH';
  }
}

/** Return a safe default ResearchBrief when the classifier fails. */
export function defaultResearchBrief(
  intent: IntentId,
  confidence: number,
  reasoning: string
): ResearchBrief {
  const resolvedMethodology = resolveMethodologyFromIntent(intent);
  const resolvedResearchObjective = resolveObjectiveFromIntent(intent);
  return {
    primaryIntent: intent,
    requestedMethodology: 'auto',
    resolvedMethodology,
    methodologyResolutionSource: 'fallback',
    secondaryIntent: undefined,
    requestedArtifacts: [],
    requestedFormats: undefined,
    userConstraints: [],
    epistemicPosture: INTENT_EPISTEMIC_POSTURE[intent] ?? 'descriptive',
    confidence,
    reasoning,
    requestedResearchObjective: 'AUTO',
    resolvedResearchObjective,
    objectiveResolutionSource: 'fallback',
    objectiveResolutionReason: `Defaulted from intent ${intent}.`,
  };
}

/** Format the ResearchBrief as a compact context block for LLM prompts. */
export function formatBriefForPrompt(brief: ResearchBrief): string {
  const lines: string[] = [
    `PRIMARY_INTENT: ${brief.primaryIntent}`,
    brief.secondaryIntent ? `SECONDARY_INTENT: ${brief.secondaryIntent}` : '',
    `EPISTEMIC_POSTURE: ${brief.epistemicPosture}`,
    `REQUESTED_METHODOLOGY: ${brief.requestedMethodology}`,
    `RESOLVED_METHODOLOGY: ${brief.resolvedMethodology}`,
    `METHODOLOGY_RESOLUTION_SOURCE: ${brief.methodologyResolutionSource}`,
    `REQUESTED_RESEARCH_OBJECTIVE: ${brief.requestedResearchObjective ?? 'AUTO'}`,
    `RESOLVED_RESEARCH_OBJECTIVE: ${brief.resolvedResearchObjective ?? 'GENERAL_EPISTEMIC_RESEARCH'}`,
    brief.objectiveResolutionSource ? `OBJECTIVE_RESOLUTION_SOURCE: ${brief.objectiveResolutionSource}` : '',
    brief.objectiveResolutionReason ? `OBJECTIVE_RESOLUTION_REASON: ${brief.objectiveResolutionReason}` : '',
    `CONFIDENCE: ${brief.confidence.toFixed(2)}`,
  ];
  if (brief.requestedArtifacts.length > 0) {
    lines.push(`REQUESTED_ARTIFACTS:`);
    for (const a of brief.requestedArtifacts) {
      const countNote = a.exactCount != null ? ` [exact count: ${a.exactCount}]` : '';
      const explicitNote =
        a.explicitRequiredFields && a.explicitRequiredFields.length > 0
          ? ` [user-requested fields: ${a.explicitRequiredFields.join(', ')}]`
          : '';
      const inferredNote =
        a.inferredRequiredFields && a.inferredRequiredFields.length > 0
          ? ` [inferred required fields: ${a.inferredRequiredFields.join(', ')}]`
          : '';
      // Backward compat: fall back to requiredFields if neither explicit nor inferred
      const legacyNote =
        !explicitNote && !inferredNote && a.requiredFields && a.requiredFields.length > 0
          ? ` [required fields: ${a.requiredFields.join(', ')}]`
          : '';
      const optionalNote =
        a.optionalFields && a.optionalFields.length > 0
          ? ` [optional enrichment: ${a.optionalFields.join(', ')}]`
          : '';
      lines.push(`  - ${a.description}${countNote}${explicitNote}${inferredNote}${legacyNote}${optionalNote}`);
    }
  }
  if (brief.requestedFormats && brief.requestedFormats.length > 0) {
    lines.push(`REQUESTED_FORMATS: ${brief.requestedFormats.join(', ')}`);
  }
  if (brief.userConstraints.length > 0) {
    lines.push(`USER_CONSTRAINTS:`);
    for (const c of brief.userConstraints) {
      lines.push(`  - ${c.description}`);
    }
  }
  return lines.filter(Boolean).join('\n');
}
