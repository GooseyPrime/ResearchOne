import type { IntentId } from './intentTaxonomy';
import type { SkepticMode, SteelmanMode } from './orchestrationProfiles';
import type { ResearchBrief } from './researchBrief';
import type { CanonicalExecutionPlan } from './executionPlan';

/** Structured plan persisted in `research_plans.plan_payload` (Wave 5.1). */
export interface PlanPayload {
  requestedFormats?: string[];
  targetWordCount?: number;
  requestedMethodology?: string;
  resolvedMethodology?: string;
  resolvedResearchObjective?: string;
  objectiveResolutionSource?: string;
  objectiveResolutionReason?: string;
  intent: {
    id: IntentId;
    displayLabel: string;
    confidence: number;
    reasoning: string;
  };
  topicAnalysis: {
    summary: string;
    isMultiLayer: boolean;
    isActivelyContested: boolean;
    competenceAssessment: string;
  };
  orchestrationProfile: {
    name: string;
    description: string;
    agentsWillRun: string[];
    agentsWillSkip: string[];
    /** Canonical intent key (mirrors `intent.id`). */
    intentId?: IntentId;
    outputTemplateId?: string;
    skepticMode?: SkepticMode;
    steelmanMode?: SteelmanMode;
    /** Placeholder map until Wave 5.3 classifier. */
    sourceClassWeights?: Record<string, number>;
    expectedLengthRange?: { minWords: number; maxWords: number };
    /** Canonical runtime plan consumed by both preview and worker (Phase D1). */
    executionPlan?: CanonicalExecutionPlan;
  };
  sourceStrategy: {
    summary: string;
    weightedClasses: string[];
    expectedSourceCount: { min: number; max: number };
  };
  outputShape: {
    structure: string;
    estimatedLength: { minWords: number; maxWords: number };
    documentShape: string;
  };
  estimatedCost: {
    durationSeconds: { min: number; max: number };
    estimatedTokens: number;
    estimatedCostCents: number | null;
  };
  /**
   * Phase B — the structured classifier output threaded from intent
   * classification through plan gate and into execution.  Optional for
   * backward compatibility with pre-Phase-B plans.
   */
  researchBrief?: ResearchBrief;
  /**
   * Canonical execution plan persisted on the plan payload.
   * Optional for backward compatibility with legacy plans.
   */
  executionPlan?: CanonicalExecutionPlan;
}

export function planSummaryFromPayload(plan: PlanPayload): string {
  const head = plan.topicAnalysis?.summary?.trim() || plan.intent.reasoning?.trim() || '';
  return head.slice(0, 2000);
}
