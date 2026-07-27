/**
 * Wave 5.2 — resolve canonical orchestration profile for a running job
 * and merge planner-visible plan fields from `orchestrationProfiles.ts`.
 */
import type { ResearchJobData } from '../reasoning/researchOrchestratorTypes';
import type { PlanPayload } from './planTypes';
import type { IntentId } from './intentTaxonomy';
import { selectAgentsForBrief } from '../reasoning/agentCapabilityRegistry';
import {
  getOrchestrationProfileForIntent,
  type OrchestrationProfileDefinition,
} from './orchestrationProfiles';

export function resolveOrchestrationProfileFromJob(data: ResearchJobData): OrchestrationProfileDefinition {
  const id = data.confirmedPlanPayload?.intent?.id as IntentId | undefined;
  if (id) return getOrchestrationProfileForIntent(id);
  return getOrchestrationProfileForIntent('legacy');
}

/** Enrich persisted plan_payload with canonical run/skip lists and template ids. */
export function mergePlanPayloadWithCanonicalProfile(plan: PlanPayload): PlanPayload {
  const canon = getOrchestrationProfileForIntent(plan.intent.id);
  const selectedAgents = selectAgentsForBrief(
    plan.intent.id,
    plan.researchBrief?.secondaryIntent
  );
  // Ordering: canonical core agents first (preserves pipeline order), specialist
  // agents appended. Set deduplicates in case the profile already lists a specialist.
  // Specialist agents are informational metadata for Stage D; execution wiring
  // is progressive in follow-on commits.
  const mergedAgents = Array.from(
    new Set([...canon.agentsToRun, ...selectedAgents.map((agent) => agent.id)])
  );
  const weights =
    plan.orchestrationProfile.sourceClassWeights &&
    typeof plan.orchestrationProfile.sourceClassWeights === 'object'
      ? plan.orchestrationProfile.sourceClassWeights
      : ({} as Record<string, number>);
  return {
    ...plan,
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
      agentsWillSkip: [...canon.agentsToSkip],
      expectedLengthRange: { ...canon.expectedLengthRange },
      description:
        plan.orchestrationProfile.description?.trim() ||
        `${canon.displayName} profile — ${canon.agentsToRun.length} pipeline stages active.`,
    },
  };
}
