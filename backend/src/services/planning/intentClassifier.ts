import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { IntentId } from './intentTaxonomy';
import { getIntentById, INTENT_TAXONOMY } from './intentTaxonomy';
import { RESEARCH_BRIEF_CLASSIFIER_PROMPT } from './prompts';
import { parseResearchBriefJson } from './planJson';
import type { ResearchBrief } from './researchBrief';
import {
  defaultResearchBrief,
  INTENT_EPISTEMIC_POSTURE,
  resolveMethodologyFromIntent,
  resolveObjectiveFromIntent,
} from './researchBrief';

const LEXICAL_CONFIDENCE = 0.92;
const LLM_LOW_CONFIDENCE_CAP = 0.84;

function lexicalLayer(query: string, supplemental?: string): { intent: IntentId; matches: number } | null {
  const text = `${query}\n${supplemental ?? ''}`.toLowerCase();
  const hits: Array<{ id: IntentId; n: number }> = [];
  for (const def of Object.values(INTENT_TAXONOMY)) {
    if (def.id === 'legacy') continue;
    let n = 0;
    for (const re of def.triggerPatterns) {
      re.lastIndex = 0;
      if (re.test(text)) n++;
    }
    if (n > 0) hits.push({ id: def.id, n });
  }
  if (hits.length === 1) return { intent: hits[0].id, matches: hits[0].n };
  if (hits.length > 1) {
    hits.sort((a, b) => b.n - a.n);
    if (hits[0].n > hits[1].n) return { intent: hits[0].id, matches: hits[0].n };
  }
  return null;
}

/**
 * Phase B — classifyIntent now returns a full ResearchBrief.
 *
 * The lexical layer still provides a fast path for high-signal queries, but
 * now constructs a default brief (no secondary intent, no artifact extraction)
 * so callers always receive a consistent type.  The LLM path uses the upgraded
 * RESEARCH_BRIEF_CLASSIFIER_PROMPT to extract secondary intent, requested
 * artifacts, exact counts, user constraints, and epistemic posture.
 */
export async function classifyIntent(
  query: string,
  supplementalContext: string | undefined,
  llmOpts: {
    engineVersion?: string;
    researchObjective?: import('../reasoning/reasoningModelPolicy').ResearchObjective;
    allowFallbackByRole: Record<string, boolean>;
    byokApiKeyOverride?: string;
  }
): Promise<ResearchBrief> {
  const lex = lexicalLayer(query, supplementalContext);
  if (lex && lex.matches > 0) {
    const def = getIntentById(lex.intent);
    return defaultResearchBrief(
      lex.intent,
      LEXICAL_CONFIDENCE,
      `High-signal lexical match on intent "${def?.displayLabel ?? lex.intent}" (${lex.matches} pattern hit(s)). Artifact extraction skipped on fast path.`
    );
  }

  const hasOpenRouterCredential = Boolean(
    config.openrouter.apiKey?.trim() || llmOpts.byokApiKeyOverride?.trim()
  );
  if (!hasOpenRouterCredential) {
    return defaultResearchBrief(
      'factual_report',
      0.55,
      'OpenRouter key unavailable — defaulted to factual_report with low confidence.'
    );
  }

  const userBlock = `QUERY:\n${query}\n\nSUPPLEMENTAL:\n${supplementalContext ?? '(none)'}\n`;

  const res = await callRoleModel({
    role: 'planner',
    engineVersion: llmOpts.engineVersion,
    researchObjective: llmOpts.researchObjective,
    allowFallbackByRole: llmOpts.allowFallbackByRole,
    callPurpose: 'phase_b_research_brief_classification',
    runtimeOverrides: { primary: config.models.planning },
    byokApiKeyOverride: llmOpts.byokApiKeyOverride,
    messages: [
      { role: 'system', content: RESEARCH_BRIEF_CLASSIFIER_PROMPT },
      { role: 'user', content: userBlock },
    ],
  });

  const brief = parseResearchBriefJson(res.content, 'factual_report');

  // Remap legacy to factual_report
  if (brief.primaryIntent === 'legacy') {
    brief.primaryIntent = 'factual_report';
    brief.reasoning = `${brief.reasoning} (legacy remapped to factual_report)`;
    brief.epistemicPosture = INTENT_EPISTEMIC_POSTURE['factual_report'];
  }

  brief.requestedMethodology = brief.requestedMethodology ?? 'auto';
  brief.resolvedMethodology = brief.resolvedMethodology ?? resolveMethodologyFromIntent(brief.primaryIntent);
  brief.methodologyResolutionSource = brief.methodologyResolutionSource ?? 'triage';
  brief.requestedResearchObjective = brief.requestedResearchObjective ?? 'AUTO';
  brief.resolvedResearchObjective = brief.resolvedResearchObjective ?? resolveObjectiveFromIntent(brief.primaryIntent);
  brief.objectiveResolutionSource = brief.objectiveResolutionSource ?? 'triage';
  brief.objectiveResolutionReason =
    brief.objectiveResolutionReason ?? `Resolved from primary intent ${brief.primaryIntent}.`;

  // Soft cap for low-confidence results so the gate UI can flag them
  if (brief.confidence < 0.85) {
    brief.confidence = Math.min(brief.confidence, LLM_LOW_CONFIDENCE_CAP);
  }

  return brief;
}

