import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { IntentId } from './intentTaxonomy';
import { getIntentById } from './intentTaxonomy';
import type { PlanPayload } from './planTypes';
import { PLAN_GENERATOR_PROMPT } from './prompts';
import { parsePlanGeneratorJson } from './planJson';

export async function generatePlan(input: {
  query: string;
  supplementalContext?: string;
  intent: IntentId;
  intentConfidence: number;
  llmOpts: {
    engineVersion?: string;
    researchObjective?: import('../reasoning/reasoningModelPolicy').ResearchObjective;
    allowFallbackByRole: Record<string, boolean>;
    byokApiKeyOverride?: string;
  };
}): Promise<PlanPayload> {
  const def = getIntentById(input.intent);
  const hasKey = Boolean(config.openrouter.apiKey?.trim());
  if (!hasKey) {
    return parsePlanGeneratorJson('{}', input.intent, input.intentConfidence);
  }

  const userBlock = `QUERY:\n${input.query}\n\nSUPPLEMENTAL:\n${input.supplementalContext ?? '(none)'}\n\nINTENT: ${input.intent} (${def?.displayLabel ?? input.intent})\nINTENT_CONFIDENCE: ${input.intentConfidence}\n`;

  const res = await callRoleModel({
    role: 'planner',
    engineVersion: input.llmOpts.engineVersion,
    researchObjective: input.llmOpts.researchObjective,
    allowFallbackByRole: input.llmOpts.allowFallbackByRole,
    callPurpose: 'wave5_plan_generation',
    runtimeOverrides: { primary: config.models.planning },
    byokApiKeyOverride: input.llmOpts.byokApiKeyOverride,
    messages: [
      { role: 'system', content: PLAN_GENERATOR_PROMPT },
      { role: 'user', content: userBlock },
    ],
  });

  let plan = parsePlanGeneratorJson(res.content, input.intent, input.intentConfidence);
  plan = {
    ...plan,
    intent: {
      ...plan.intent,
      id: input.intent,
      displayLabel: def?.displayLabel ?? plan.intent.displayLabel,
      confidence: input.intentConfidence,
    },
    orchestrationProfile: {
      ...plan.orchestrationProfile,
      name: def?.defaultOrchestrationProfile ?? plan.orchestrationProfile.name,
    },
  };
  return plan;
}
