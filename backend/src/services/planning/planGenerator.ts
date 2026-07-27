import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { IntentId } from './intentTaxonomy';
import { getIntentById } from './intentTaxonomy';
import { ORCHESTRATION_PROFILES } from './orchestrationProfiles';
import type { PlanPayload } from './planTypes';
import { PLAN_GENERATOR_PROMPT } from './prompts';
import { parsePlanGeneratorJson } from './planJson';
import type { ResearchBrief } from './researchBrief';
import { formatBriefForPrompt } from './researchBrief';

export async function generatePlan(input: {
  query: string;
  supplementalContext?: string;
  intent: IntentId;
  intentConfidence: number;
  /** Phase B — full ResearchBrief from the classifier; threaded into plan payload. */
  researchBrief?: ResearchBrief;
  /** Wave 5.4 — optional saved profile seed merged into the planner prompt. */
  savedProfile?: { baseIntent: string; customizations: unknown; profileName?: string };
  llmOpts: {
    engineVersion?: string;
    researchObjective?: import('../reasoning/reasoningModelPolicy').ResearchObjective;
    allowFallbackByRole: Record<string, boolean>;
    byokApiKeyOverride?: string;
  };
}): Promise<PlanPayload> {
  const def = getIntentById(input.intent);
  const hasOpenRouterCredential = Boolean(
    config.openrouter.apiKey?.trim() || input.llmOpts.byokApiKeyOverride?.trim()
  );
  if (!hasOpenRouterCredential) {
    return parsePlanGeneratorJson(
      '{}',
      input.intent,
      input.intentConfidence,
      input.researchBrief
    );
  }

  let profileBlock = '';
  if (input.savedProfile) {
    const label = input.savedProfile.profileName?.trim() || 'Saved profile';
    profileBlock = `\nSAVED_ORCHESTRATION_PROFILE (${label} — starting point; reconcile with QUERY and current INTENT):\nBASE_INTENT: ${input.savedProfile.baseIntent}\nCUSTOMIZATIONS_JSON:\n${JSON.stringify(input.savedProfile.customizations ?? {}, null, 2)}\n`;
  }

  // Phase B — include the ResearchBrief in the planner context so the plan
  // preview accurately reflects the extracted artifacts and constraints.
  const briefBlock = input.researchBrief
    ? `\nRESEARCH_BRIEF (extracted by classifier — use this to guide plan output shape):\n${formatBriefForPrompt(input.researchBrief)}\n`
    : '';

  const userBlock = `QUERY:\n${input.query}\n\nSUPPLEMENTAL:\n${input.supplementalContext ?? '(none)'}\n\nINTENT: ${input.intent} (${def?.displayLabel ?? input.intent})\nINTENT_CONFIDENCE: ${input.intentConfidence}${briefBlock}${profileBlock}`;

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

  const parsedPlan = parsePlanGeneratorJson(
    res.content,
    input.intent,
    input.intentConfidence,
    input.researchBrief
  );
  return {
    ...parsedPlan,
    intent: {
      ...parsedPlan.intent,
      id: input.intent,
      displayLabel: def?.displayLabel ?? parsedPlan.intent.displayLabel,
      confidence: input.intentConfidence,
    },
    orchestrationProfile: {
      ...parsedPlan.orchestrationProfile,
      name: ORCHESTRATION_PROFILES[input.intent]?.displayName ?? parsedPlan.orchestrationProfile.name,
    },
  };
}
