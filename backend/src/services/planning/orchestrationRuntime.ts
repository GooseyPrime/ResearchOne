/**
 * Wave 5.2 — resolve canonical orchestration profile for a running job
 * and merge planner-visible plan fields from `orchestrationProfiles.ts`.
 */
import type { ResearchJobData } from '../reasoning/researchOrchestratorTypes';
import type { PlanPayload } from './planTypes';
import type { IntentId } from './intentTaxonomy';
import {
  getOrchestrationProfileForIntent,
  type OrchestrationProfileDefinition,
} from './orchestrationProfiles';
import { buildCanonicalExecutionPlan } from './executionPlan';

export function resolveOrchestrationProfileFromJob(data: ResearchJobData): OrchestrationProfileDefinition {
  const id = data.confirmedPlanPayload?.intent?.id as IntentId | undefined;
  if (id) return getOrchestrationProfileForIntent(id);
  return getOrchestrationProfileForIntent('legacy');
}

/** Enrich persisted plan_payload with canonical run/skip lists and template ids. */
export function mergePlanPayloadWithCanonicalProfile(plan: PlanPayload): PlanPayload {
  const canon = getOrchestrationProfileForIntent(plan.intent.id);
  const executionPlan = buildCanonicalExecutionPlan({
    profile: canon,
    researchBrief: plan.researchBrief,
    sourceClasses: Array.isArray(plan.sourceStrategy?.weightedClasses)
      ? plan.sourceStrategy.weightedClasses
      : [],
  });
  const mergedAgents = Array.from(new Set([...executionPlan.coreAgentRoles, ...executionPlan.specialistAgents]));
  const skippedAgents = executionPlan.specialistAgents.filter(
    (id) => executionPlan.statuses?.[id] === 'unavailable' || executionPlan.statuses?.[id] === 'skipped'
  );
  const weights =
    plan.orchestrationProfile.sourceClassWeights &&
    typeof plan.orchestrationProfile.sourceClassWeights === 'object'
      ? plan.orchestrationProfile.sourceClassWeights
      : ({} as Record<string, number>);
  return {
    ...plan,
    requestedFormats: plan.requestedFormats ?? plan.researchBrief?.requestedFormats,
    outputShape: {
      ...plan.outputShape,
      estimatedLength: {
        minWords: canon.expectedLengthRange.minWords,
        maxWords: canon.expectedLengthRange.maxWords,
      },
    },
    orchestrationProfile: {
      ...plan.orchestrationProfile,
      name: canon.displayName,
      intentId: canon.intent,
      outputTemplateId: canon.outputTemplateId,
      skepticMode: canon.skepticMode,
      steelmanMode: canon.steelmanMode,
      sourceClassWeights: weights,
      agentsWillRun: mergedAgents,
      agentsWillSkip: skippedAgents,
      executionPlan,
      expectedLengthRange: { ...canon.expectedLengthRange },
      description:
        plan.orchestrationProfile.description?.trim() ||
        `${canon.displayName} profile — ${executionPlan.corePipelineStages.length} stages active.`,
    },
    executionPlan,
  };
}
