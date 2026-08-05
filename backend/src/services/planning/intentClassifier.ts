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

/** High confidence only when lexical evidence is strong. */
const LEXICAL_CONFIDENCE_STRONG = 0.92;
/** Single specific-intent hit — still useful but plan gate should show medium. */
const LEXICAL_CONFIDENCE_MODERATE = 0.78;

/**
 * Intents with relatively precise trigger language. A single pattern hit is
 * enough to accept the lexical fast path for these ids.
 */
const HIGH_SPECIFICITY_INTENTS = new Set<IntentId>([
  'adjudication',
  'story_verification',
  'literature_review',
  'reference_lookup',
  'position_brief',
  'timeline',
  'implementation',
  'feasibility',
  'opportunity_discovery',
  'comparative',
  'how_to',
  'recommendation',
]);

/** Prefer more specific intents when hit counts are tied. */
const SPECIFICITY_RANK: IntentId[] = [
  'reference_lookup',
  'story_verification',
  'adjudication',
  'position_brief',
  'literature_review',
  'timeline',
  'implementation',
  'feasibility',
  'opportunity_discovery',
  'comparative',
  'how_to',
  'recommendation',
  'investigation',
  'survey',
  'exploratory',
  'factual_report',
];

function specificityScore(id: IntentId): number {
  const idx = SPECIFICITY_RANK.indexOf(id);
  return idx === -1 ? SPECIFICITY_RANK.length : idx;
}

function lexicalLayer(
  query: string,
  supplemental?: string
): { intent: IntentId; matches: number; confidence: number } | null {
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
  if (hits.length === 0) return null;

  hits.sort((a, b) => {
    if (b.n !== a.n) return b.n - a.n;
    return specificityScore(a.id) - specificityScore(b.id);
  });

  const top = hits[0];
  const runner = hits[1];

  if (hits.length === 1) {
    // Broad single-token intents (e.g. exploratory "interesting") are brittle —
    // defer to the LLM unless the intent is high-specificity or multi-hit.
    if (HIGH_SPECIFICITY_INTENTS.has(top.id) || top.n >= 2) {
      return {
        intent: top.id,
        matches: top.n,
        confidence: top.n >= 2 ? LEXICAL_CONFIDENCE_STRONG : LEXICAL_CONFIDENCE_MODERATE,
      };
    }
    return null;
  }

  // Multiple intents matched: require a clear margin, else LLM.
  if (top.n > runner.n) {
    return {
      intent: top.id,
      matches: top.n,
      confidence: top.n >= 2 ? LEXICAL_CONFIDENCE_STRONG : LEXICAL_CONFIDENCE_MODERATE,
    };
  }

  // Tie on hit count — prefer higher-specificity intent only when ranks differ.
  if (specificityScore(top.id) < specificityScore(runner.id)) {
    return {
      intent: top.id,
      matches: top.n,
      confidence: LEXICAL_CONFIDENCE_MODERATE,
    };
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
      lex.confidence,
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
    brief.confidence = Math.min(brief.confidence, 0.84);
  }

  return brief;
}
