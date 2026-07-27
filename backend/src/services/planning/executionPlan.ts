import type { PipelineStage, OrchestrationProfileDefinition } from './orchestrationProfiles';
import type { ResearchBrief } from './researchBrief';
import {
  CORE_AGENT_IDS,
  SPECIALIST_AGENT_ID_LIST,
  selectAgentsForBrief,
  type AgentRoleId,
  type SpecialistAgentId,
} from '../reasoning/agentCapabilityRegistry';

export type SpecialistExecutionStatus =
  | 'planned'
  | 'succeeded'
  | 'skipped'
  | 'unavailable'
  | 'invalid_output'
  | 'failed';

export interface CanonicalExecutionPlan {
  version: number;
  intent: string;
  secondaryIntent?: string;
  corePipelineStages: PipelineStage[];
  coreAgentRoles: AgentRoleId[];
  specialistAgents: SpecialistAgentId[];
  sourceClasses: string[];
  executionGroups: SpecialistAgentId[][];
  dependsOn: Partial<Record<SpecialistAgentId, SpecialistAgentId[]>>;
  skipReasons: Partial<Record<PipelineStage | SpecialistAgentId, string>>;
  expectedOutputTemplateId: string;
  statuses?: Partial<Record<SpecialistAgentId, SpecialistExecutionStatus>>;
}

interface RuntimeAvailability {
  unavailableSpecialists?: Partial<Record<SpecialistAgentId, string>>;
}

export function buildCanonicalExecutionPlan(input: {
  profile: OrchestrationProfileDefinition;
  researchBrief?: ResearchBrief;
  sourceClasses?: string[];
  runtimeAvailability?: RuntimeAvailability;
}): CanonicalExecutionPlan {
  const { profile, researchBrief } = input;
  const selected = selectAgentsForBrief(
    researchBrief?.primaryIntent ?? profile.intent,
    researchBrief?.secondaryIntent
  );
  const specialists = selected
    .map((agent) => agent.id)
    .filter((id): id is SpecialistAgentId =>
      (SPECIALIST_AGENT_ID_LIST as readonly string[]).includes(id)
    );

  const unavailable = input.runtimeAvailability?.unavailableSpecialists ?? {};
  const runnableSpecialists = specialists.filter((id) => !unavailable[id]);
  const skipReasons: Partial<Record<PipelineStage | SpecialistAgentId, string>> = {};
  for (const s of profile.agentsToSkip) {
    skipReasons[s] = 'Skipped by canonical intent profile.';
  }
  for (const specialist of specialists) {
    if (unavailable[specialist]) {
      skipReasons[specialist] = unavailable[specialist] ?? 'Unavailable in current runtime.';
    }
  }

  const hasTimeline = runnableSpecialists.includes('timeline_reconstructor');
  const hasStory = runnableSpecialists.includes('story_verifier');
  const hasFeasibility = runnableSpecialists.includes('feasibility_architect');

  const group1 = runnableSpecialists.filter(
    (id) =>
      id === 'market_scout' ||
      id === 'competitor_mapper' ||
      id === 'demand_signal_analyst' ||
      id === 'timeline_reconstructor'
  );
  const group2 = runnableSpecialists.filter(
    (id) => id === 'story_verifier' || id === 'feasibility_architect'
  );
  const executionGroups = [group1, group2].filter((g) => g.length > 0);

  const dependsOn: Partial<Record<SpecialistAgentId, SpecialistAgentId[]>> = {};
  if (hasStory && hasTimeline) dependsOn.story_verifier = ['timeline_reconstructor'];
  if (hasFeasibility) {
    const deps = [
      SPECIALIST_AGENT_ID_LIST[0],
      SPECIALIST_AGENT_ID_LIST[1],
      SPECIALIST_AGENT_ID_LIST[2],
    ].filter((id) => runnableSpecialists.includes(id));
    if (deps.length > 0) dependsOn.feasibility_architect = [...deps];
  }

  return {
    version: 1,
    intent: profile.intent,
    secondaryIntent: researchBrief?.secondaryIntent,
    corePipelineStages: [...profile.agentsToRun],
    coreAgentRoles: [...CORE_AGENT_IDS],
    specialistAgents: specialists,
    sourceClasses: input.sourceClasses ?? [],
    executionGroups,
    dependsOn,
    skipReasons,
    expectedOutputTemplateId: profile.outputTemplateId,
    statuses: Object.fromEntries(
      specialists.map((id) =>
        unavailable[id]
          ? [id, 'unavailable' as SpecialistExecutionStatus]
          : [id, 'planned' as SpecialistExecutionStatus]
      )
    ) as Partial<Record<SpecialistAgentId, SpecialistExecutionStatus>>,
  };
}
