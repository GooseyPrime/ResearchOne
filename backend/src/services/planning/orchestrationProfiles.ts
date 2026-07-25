/**
 * Wave 5.2 — canonical per-intent orchestration profiles (agents, skeptic mode, templates).
 * Stage keys align with `researchOrchestrator` progress_stage values + internal gates.
 */
import type { IntentId } from './intentTaxonomy';

/** Stages the orchestrator may run or skip (matches progress_stage strings). */
export const PIPELINE_STAGES = [
  'planning',
  'discovery',
  'retrieval',
  'retriever_analysis',
  'reasoning',
  'challenge',
  'synthesis',
  'verification',
  'plain_language',
  'saving',
  'epistemic_persistence',
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export type SkepticMode = 'off' | 'gate' | 'annotate';

/** Placeholder until Wave 5.3 wires steelman agent. */
export type SteelmanMode = 'off' | 'standard' | 'per_option' | 'as_product' | 'symmetric';

export interface OrchestrationProfileDefinition {
  intent: IntentId;
  displayName: string;
  agentsToRun: readonly PipelineStage[];
  agentsToSkip: readonly PipelineStage[];
  skepticMode: SkepticMode;
  steelmanMode: SteelmanMode;
  /** Stable id for report layout / dossier UI (Wave 5.2 templates). */
  outputTemplateId: string;
  expectedLengthRange: { minWords: number; maxWords: number };
}

function P(p: Omit<OrchestrationProfileDefinition, 'intent'> & { intent: IntentId }): OrchestrationProfileDefinition {
  const run = [...p.agentsToRun];
  const skip = [...p.agentsToSkip];
  const all = new Set([...run, ...skip]);
  for (const s of PIPELINE_STAGES) {
    if (!all.has(s)) {
      throw new Error(`orchestrationProfiles: stage "${s}" missing for intent ${p.intent}`);
    }
  }
  if (run.length + skip.length !== PIPELINE_STAGES.length) {
    throw new Error(`orchestrationProfiles: duplicate or extra stages for intent ${p.intent}`);
  }
  return p;
}

const FULL: readonly PipelineStage[] = [...PIPELINE_STAGES];

function skipOnly(...skipped: PipelineStage[]): {
  agentsToRun: readonly PipelineStage[];
  agentsToSkip: readonly PipelineStage[];
} {
  const sk = new Set(skipped);
  return {
    agentsToRun: PIPELINE_STAGES.filter((s) => !sk.has(s)),
    agentsToSkip: PIPELINE_STAGES.filter((s) => sk.has(s)),
  };
}

/** One profile per intent (12 + legacy fallback). */
export const ORCHESTRATION_PROFILES: Record<IntentId, OrchestrationProfileDefinition> = {
  factual_report: P({
    intent: 'factual_report',
    displayName: 'Factual report',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_factual_report',
    expectedLengthRange: { minWords: 1200, maxWords: 6000 },
  }),
  survey: P({
    intent: 'survey',
    displayName: 'Survey',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'annotate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_survey',
    expectedLengthRange: { minWords: 2500, maxWords: 12000 },
  }),
  adjudication: P({
    intent: 'adjudication',
    displayName: 'Adjudication',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_adjudication',
    expectedLengthRange: { minWords: 2000, maxWords: 9000 },
  }),
  investigation: P({
    intent: 'investigation',
    displayName: 'Investigation',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'symmetric',
    outputTemplateId: 'intent_investigation',
    expectedLengthRange: { minWords: 3500, maxWords: 14000 },
  }),
  story_verification: P({
    intent: 'story_verification',
    displayName: 'Story verification',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_story_verification',
    expectedLengthRange: { minWords: 1500, maxWords: 8000 },
  }),
  literature_review: P({
    intent: 'literature_review',
    displayName: 'Literature review',
    agentsToRun: FULL,
    agentsToSkip: [],
    /** Methodology-style cross-checks live in sidebar (Wave 5.2). */
    skepticMode: 'annotate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_literature_review',
    expectedLengthRange: { minWords: 4000, maxWords: 16000 },
  }),
  comparative: P({
    intent: 'comparative',
    displayName: 'Comparative',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'per_option',
    outputTemplateId: 'intent_comparative',
    expectedLengthRange: { minWords: 3000, maxWords: 12000 },
  }),
  how_to: P({
    intent: 'how_to',
    displayName: 'How-to',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_how_to',
    expectedLengthRange: { minWords: 1500, maxWords: 8000 },
  }),
  recommendation: P({
    intent: 'recommendation',
    displayName: 'Recommendation',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_recommendation',
    expectedLengthRange: { minWords: 2500, maxWords: 10000 },
  }),
  exploratory: P({
    intent: 'exploratory',
    displayName: 'Exploratory',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_exploratory',
    expectedLengthRange: { minWords: 1200, maxWords: 7000 },
  }),
  opportunity_discovery: P({
    intent: 'opportunity_discovery',
    displayName: 'Opportunity discovery',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_opportunity_discovery',
    expectedLengthRange: { minWords: 2000, maxWords: 12000 },
  }),
  feasibility: P({
    intent: 'feasibility',
    displayName: 'Feasibility analysis',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_feasibility',
    expectedLengthRange: { minWords: 1500, maxWords: 8000 },
  }),
  implementation: P({
    intent: 'implementation',
    displayName: 'Implementation plan',
    ...skipOnly('challenge'),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_implementation',
    expectedLengthRange: { minWords: 1500, maxWords: 10000 },
  }),
  position_brief: P({
    intent: 'position_brief',
    displayName: 'Position brief',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'as_product',
    outputTemplateId: 'intent_position_brief',
    expectedLengthRange: { minWords: 2000, maxWords: 9000 },
  }),
  timeline: P({
    intent: 'timeline',
    displayName: 'Timeline',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'standard',
    outputTemplateId: 'intent_timeline',
    expectedLengthRange: { minWords: 2000, maxWords: 10000 },
  }),
  reference_lookup: P({
    intent: 'reference_lookup',
    displayName: 'Reference lookup',
    ...skipOnly(
      'discovery',
      'reasoning',
      'challenge',
      'synthesis',
      'plain_language',
      'epistemic_persistence',
    ),
    skepticMode: 'off',
    steelmanMode: 'off',
    outputTemplateId: 'intent_reference_lookup',
    expectedLengthRange: { minWords: 400, maxWords: 2500 },
  }),
  legacy: P({
    intent: 'legacy',
    displayName: 'Legacy',
    agentsToRun: FULL,
    agentsToSkip: [],
    skepticMode: 'gate',
    steelmanMode: 'off',
    outputTemplateId: 'intent_legacy',
    expectedLengthRange: { minWords: 2000, maxWords: 12000 },
  }),
};

export function getOrchestrationProfileForIntent(intent: IntentId): OrchestrationProfileDefinition {
  return ORCHESTRATION_PROFILES[intent] ?? ORCHESTRATION_PROFILES.legacy;
}

export function shouldRunPipelineStage(
  profile: OrchestrationProfileDefinition,
  stage: PipelineStage,
): boolean {
  return profile.agentsToRun.includes(stage);
}
