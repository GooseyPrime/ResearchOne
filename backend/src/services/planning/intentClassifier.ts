import { config } from '../../config';
import { callRoleModel } from '../openrouter/openrouterService';
import type { IntentId } from './intentTaxonomy';
import { getIntentById, INTENT_TAXONOMY } from './intentTaxonomy';
import { INTENT_CLASSIFIER_PROMPT } from './prompts';
import { parseIntentClassifierJson } from './planJson';

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

export async function classifyIntent(
  query: string,
  supplementalContext: string | undefined,
  llmOpts: {
    engineVersion?: string;
    researchObjective?: import('../reasoning/reasoningModelPolicy').ResearchObjective;
    allowFallbackByRole: Record<string, boolean>;
    byokApiKeyOverride?: string;
  }
): Promise<{ intent: IntentId; confidence: number; reasoning: string }> {
  const lex = lexicalLayer(query, supplementalContext);
  if (lex && lex.matches > 0) {
    const def = getIntentById(lex.intent);
    return {
      intent: lex.intent,
      confidence: LEXICAL_CONFIDENCE,
      reasoning: `High-signal lexical match on intent "${def?.displayLabel ?? lex.intent}" (${lex.matches} pattern hit(s)).`,
    };
  }

  const hasOpenRouterCredential = Boolean(
    config.openrouter.apiKey?.trim() || llmOpts.byokApiKeyOverride?.trim()
  );
  if (!hasOpenRouterCredential) {
    return {
      intent: 'factual_report',
      confidence: 0.55,
      reasoning: 'OpenRouter key unavailable — defaulted to factual_report with low confidence.',
    };
  }

  const userBlock = `QUERY:\n${query}\n\nSUPPLEMENTAL:\n${supplementalContext ?? '(none)'}\n`;

  const res = await callRoleModel({
    role: 'planner',
    engineVersion: llmOpts.engineVersion,
    researchObjective: llmOpts.researchObjective,
    allowFallbackByRole: llmOpts.allowFallbackByRole,
    callPurpose: 'wave5_intent_classification',
    runtimeOverrides: { primary: config.models.planning },
    byokApiKeyOverride: llmOpts.byokApiKeyOverride,
    messages: [
      { role: 'system', content: INTENT_CLASSIFIER_PROMPT },
      { role: 'user', content: userBlock },
    ],
  });

  const parsed = parseIntentClassifierJson(res.content, 'factual_report');
  if (parsed.intent === 'legacy') {
    return { ...parsed, intent: 'factual_report', reasoning: `${parsed.reasoning} (legacy remapped to factual_report)` };
  }
  // Layer 3 — soft cap so gate UI can flag "review carefully" without blocking
  if (parsed.confidence < 0.85) {
    return { ...parsed, confidence: Math.min(parsed.confidence, LLM_LOW_CONFIDENCE_CAP) };
  }
  return parsed;
}
