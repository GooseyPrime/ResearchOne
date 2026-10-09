import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { PlanPayload } from './planTypes';
import { PLAN_LENGTH_FIT_INSTRUCTION, PLAN_PLAIN_WORDS_INSTRUCTION, PLAN_REFINEMENT_PROMPT } from './prompts';
import { parsePlanRefinementJson } from './planJson';

/** The whole instruction the planning step is given when a plan is changed. Read by the wording test. */
export function planRefinementSystemPrompt(): string {
  return `${PLAN_REFINEMENT_PROMPT}\n${PLAN_LENGTH_FIT_INSTRUCTION} If the report type changes, size estimatedLength again for the new type.\n${PLAN_PLAIN_WORDS_INSTRUCTION}\nKeep "title" as it is unless the subject of the research changes.`;
}

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
  const hasOpenRouterCredential = Boolean(
    config.openrouter.apiKey?.trim() || input.llmOpts.byokApiKeyOverride?.trim()
  );
  if (!hasOpenRouterCredential) {
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
      // A revised plan is sized the way a first plan is. A changed report type
      // is sized again for the new type.
      {
        role: 'system',
        content: planRefinementSystemPrompt(),
      },
      { role: 'user', content: userBlock },
    ],
  });

  const out = parsePlanRefinementJson(res.content, input.currentPlan);
  return out;
}
