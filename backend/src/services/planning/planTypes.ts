import type { IntentId } from './intentTaxonomy';
import type { SkepticMode, SteelmanMode } from './orchestrationProfiles';
import type { ResearchBrief } from './researchBrief';

/** Structured plan persisted in `research_plans.plan_payload` (Wave 5.1). */
export interface PlanPayload {
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
}

export function planSummaryFromPayload(plan: PlanPayload): string {
  const head = plan.topicAnalysis?.summary?.trim() || plan.intent.reasoning?.trim() || '';
  return head.slice(0, 2000);
}
