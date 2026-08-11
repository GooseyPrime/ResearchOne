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
/** Explicit user declaration — highest confidence tier. */
const EXPLICIT_DECLARATION_CONFIDENCE = 0.98;

/**
 * Mapping from natural-language synonyms to canonical IntentId values.
 * Used by the explicit-declaration pre-pass to normalize user-provided
 * intent names before routing through the rest of classification.
 */
const INTENT_ALIAS_MAP: Record<string, IntentId> = {
  // factual_report
  factual_report: 'factual_report',
  factual: 'factual_report',
  'factual report': 'factual_report',
  fact: 'factual_report',
  facts: 'factual_report',
  // survey
  survey: 'survey',
  landscape: 'survey',
  overview: 'survey',
  // adjudication
  adjudication: 'adjudication',
  adjudicate: 'adjudication',
  'fact check': 'adjudication',
  'fact-check': 'adjudication',
  factcheck: 'adjudication',
  verify: 'adjudication',
  verification: 'adjudication',
  // investigation
  investigation: 'investigation',
  investigate: 'investigation',
  investigative: 'investigation',
  // story_verification
  story_verification: 'story_verification',
  'story verification': 'story_verification',
  'story verif': 'story_verification',
  // opportunity_discovery
  opportunity_discovery: 'opportunity_discovery',
  'opportunity discovery': 'opportunity_discovery',
  opportunity: 'opportunity_discovery',
  opportunities: 'opportunity_discovery',
  'market opportunity': 'opportunity_discovery',
  'market opportunities': 'opportunity_discovery',
  discovery: 'opportunity_discovery',
  // feasibility
  feasibility: 'feasibility',
  feasible: 'feasibility',
  viability: 'feasibility',
  viable: 'feasibility',
  'feasibility analysis': 'feasibility',
  'feasibility study': 'feasibility',
  // implementation
  implementation: 'implementation',
  implement: 'implementation',
  'implementation plan': 'implementation',
  'action plan': 'implementation',
  roadmap: 'implementation',
  // literature_review
  literature_review: 'literature_review',
  'literature review': 'literature_review',
  'lit review': 'literature_review',
  'systematic review': 'literature_review',
  // comparative
  comparative: 'comparative',
  comparison: 'comparative',
  compare: 'comparative',
  // how_to
  how_to: 'how_to',
  'how to': 'how_to',
  howto: 'how_to',
  'how-to': 'how_to',
  tutorial: 'how_to',
  guide: 'how_to',
  'step by step': 'how_to',
  'step-by-step': 'how_to',
  // recommendation
  recommendation: 'recommendation',
  recommend: 'recommendation',
  recommendations: 'recommendation',
  // exploratory
  exploratory: 'exploratory',
  explore: 'exploratory',
  exploration: 'exploratory',
  // position_brief
  position_brief: 'position_brief',
  'position brief': 'position_brief',
  position: 'position_brief',
  'make the case': 'position_brief',
  advocacy: 'position_brief',
  // timeline
  timeline: 'timeline',
  chronology: 'timeline',
  chronological: 'timeline',
  // reference_lookup
  reference_lookup: 'reference_lookup',
  'reference lookup': 'reference_lookup',
  'quick lookup': 'reference_lookup',
  lookup: 'reference_lookup',
  'quick answer': 'reference_lookup',
};

/**
 * Explicit intent declaration pre-pass.
 *
 * Scans the query for patterns such as:
 *   "Primary research intent: opportunity_discovery"
 *   "Intent: feasibility"
 *   "Use opportunity discovery"
 *   "Treat this as a literature review"
 *   "I want a recommendation report"
 *
 * This step runs BEFORE the lexical layer and BEFORE the LLM.
 * An explicit declaration always wins over lexical trigger matching.
 */
function explicitDeclarationLayer(
  query: string,
  supplemental?: string
): { intent: IntentId; confidence: number; reason: string } | null {
  const text = `${query}\n${supplemental ?? ''}`;

  // Pattern 1: labelled declaration (case-insensitive)
  // "Primary research intent: X", "Intent: X", "Research intent: X", "Report type: X"
  const labelledPattern =
    /(?:primary\s+research\s+intent|research\s+intent|report\s+type|intent|report\s+kind)\s*[:=]\s*([^\n.,;]+)/gi;
  let match: RegExpExecArray | null;
  while ((match = labelledPattern.exec(text)) !== null) {
    const candidate = match[1].trim().toLowerCase();
    const resolved = resolveIntentAlias(candidate);
    if (resolved) {
      return {
        intent: resolved,
        confidence: EXPLICIT_DECLARATION_CONFIDENCE,
        reason: `Explicit intent declaration found: "${match[0].trim()}" → resolved to "${resolved}".`,
      };
    }
  }

  // Pattern 2: imperative declaration
  // "Use opportunity discovery", "Treat this as a literature review", "Run as feasibility"
  const imperativePattern =
    /(?:use|run\s+(?:this\s+)?as|treat\s+this\s+as|run\s+as|classify\s+as|route\s+as)\s+(?:a\s+|an\s+)?([^\n.,;]+)/gi;
  while ((match = imperativePattern.exec(text)) !== null) {
    const candidate = match[1].trim().toLowerCase();
    const resolved = resolveIntentAlias(candidate);
    if (resolved) {
      return {
        intent: resolved,
        confidence: EXPLICIT_DECLARATION_CONFIDENCE,
        reason: `Imperative intent declaration: "${match[0].trim()}" → resolved to "${resolved}".`,
      };
    }
  }

  // Pattern 3: "I want a/an X report", "I need a/an X analysis"
  const wantPattern = /i\s+(?:want|need|would\s+like)\s+(?:you\s+to\s+(?:produce\s+)?)?(?:a\s+|an\s+)?([^\n.,;]+?)\s+(?:report|analysis|review|guide|plan|brief)/gi;
  while ((match = wantPattern.exec(text)) !== null) {
    const candidate = match[1].trim().toLowerCase();
    const resolved = resolveIntentAlias(candidate);
    if (resolved) {
      return {
        intent: resolved,
        confidence: EXPLICIT_DECLARATION_CONFIDENCE - 0.03,
        reason: `Explicit intent request: "${match[0].trim()}" → resolved to "${resolved}".`,
      };
    }
  }

  return null;
}

/**
 * Normalize a candidate string to a known IntentId via alias map.
 * Tries exact match, then progressively looser substring matches.
 */
function resolveIntentAlias(candidate: string): IntentId | null {
  const normalized = candidate.trim().toLowerCase();

  // Exact match
  if (normalized in INTENT_ALIAS_MAP) return INTENT_ALIAS_MAP[normalized];

  // Try with underscores replaced by spaces
  const deUnderscored = normalized.replace(/_/g, ' ');
  if (deUnderscored in INTENT_ALIAS_MAP) return INTENT_ALIAS_MAP[deUnderscored];

  // Try trimming trailing "report", "analysis", "study", "guide"
  const stripped = normalized.replace(/\s+(report|analysis|study|guide|plan|review|mode|type)$/, '').trim();
  if (stripped in INTENT_ALIAS_MAP) return INTENT_ALIAS_MAP[stripped];
  const strippedDeUnd = stripped.replace(/_/g, ' ');
  if (strippedDeUnd in INTENT_ALIAS_MAP) return INTENT_ALIAS_MAP[strippedDeUnd];

  // Check if any alias key is contained as the start of the candidate
  for (const [alias, intentId] of Object.entries(INTENT_ALIAS_MAP)) {
    if (normalized.startsWith(alias) || alias.startsWith(normalized)) {
      return intentId;
    }
  }

  return null;
}

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
  // ── Step 0: Explicit declaration pre-pass ────────────────────────────────
  // An explicit user declaration ("Primary research intent: X", "Use X mode",
  // etc.) ALWAYS wins over lexical and LLM classification.  This prevents
  // incidental vocabulary such as "compare" or "recommend" from overriding
  // a user's stated intent.
  const explicit = explicitDeclarationLayer(query, supplementalContext);
  if (explicit) {
    const def = getIntentById(explicit.intent);
    return defaultResearchBrief(
      explicit.intent,
      explicit.confidence,
      explicit.reason +
        (def ? ` Display label: "${def.displayLabel}".` : '') +
        ' Explicit declarations override lexical and LLM classification.'
    );
  }

  // ── Step 1: Lexical fast path ─────────────────────────────────────────────
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
