import { runWithFlags } from '../../config';
/**
 * the orchestration-profile pass — resolve canonical orchestration profile for a running job
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
      estimatedLength:
        plan.outputShape?.estimatedLength?.minWords > 0 && plan.outputShape?.estimatedLength?.maxWords > 0
          ? plan.outputShape.estimatedLength
          : { minWords: canon.expectedLengthRange.minWords, maxWords: canon.expectedLengthRange.maxWords },
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

/**
 * The confirmed plan as a run reads it, merged under that run's own switches.
 *
 * A run resumed after its plan was confirmed loads the plan before the job's
 * switch scope exists. Merged there, a run whose Layer 1 switch was turned on
 * for it alone lost the planner's length and got the report type's standard
 * range: a one-line question was sized as a 3,600-word report.
 */
export function mergePlanPayloadForRun(plan: PlanPayload, runFlags: Record<string, boolean> | null | undefined): PlanPayload {
  return runWithFlags(runFlags, () => mergePlanPayloadWithCanonicalProfile(plan));
}
