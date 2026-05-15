import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { PlanPayload } from './planTypes';
import { PLAN_REFINEMENT_PROMPT } from './prompts';
import { parsePlanRefinementJson } from './planJson';

export async function refinePlan(input: {
  currentPlan: PlanPayload;
  refinementInstruction: string;
  query: string;
  llmOpts: {
    engineVersion?: string;
    researchObjective?: import('../reasoning/reasoningModelPolicy').ResearchObjective;
    allowFallbackByRole: Record<string, boolean>;
    byokApiKeyOverride?: string;
  };
}): Promise<{
  revisedPlan: PlanPayload;
  diffSummary: string;
  intentChange: { detected: boolean; from: string | null; to: string | null; rationale: string };
}> {
  const hasKey = Boolean(config.openrouter.apiKey?.trim());
  if (!hasKey) {
    return {
      revisedPlan: input.currentPlan,
      diffSummary: 'OpenRouter key unavailable — no refinement applied.',
      intentChange: { detected: false, from: null, to: null, rationale: '' },
    };
  }

  const userBlock = `QUERY:\n${input.query}\n\nCURRENT_PLAN_JSON:\n${JSON.stringify(input.currentPlan)}\n\nREFINEMENT_INSTRUCTION:\n${input.refinementInstruction}\n`;

  const res = await callRoleModel({
    role: 'planner',
    engineVersion: input.llmOpts.engineVersion,
    researchObjective: input.llmOpts.researchObjective,
    allowFallbackByRole: input.llmOpts.allowFallbackByRole,
    callPurpose: 'wave5_plan_refinement',
    runtimeOverrides: { primary: config.models.planning },
    byokApiKeyOverride: input.llmOpts.byokApiKeyOverride,
    messages: [
      { role: 'system', content: PLAN_REFINEMENT_PROMPT },
      { role: 'user', content: userBlock },
    ],
  });

  const out = parsePlanRefinementJson(res.content, input.currentPlan);
  return out;
}
