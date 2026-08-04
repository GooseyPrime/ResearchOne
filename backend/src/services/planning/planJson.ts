import { logger } from '../../utils/logger';
import type { IntentId } from './intentTaxonomy';
import { getIntentById } from './intentTaxonomy';
import type { PlanPayload } from './planTypes';
import { planSummaryFromPayload } from './planTypes';
import { mergePlanPayloadWithCanonicalProfile } from './orchestrationRuntime';
import type { ResearchBrief, EpistemicPosture, RequestedArtifact, UserConstraint } from './researchBrief';
import {
  INTENT_EPISTEMIC_POSTURE,
  defaultResearchBrief,
  resolveMethodologyFromIntent,
  resolveObjectiveFromIntent,
} from './researchBrief';

function extractJsonObject(raw: string): string | null {
  const t = raw.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fence?.[1]?.trim() || t;
  const start = body.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (c === '{') depth++;
    else if (c === '}') {
      depth--;
      if (depth === 0) return body.slice(start, i + 1);
    }
  }
  return null;
}

const INTENT_IDS = new Set<string>([
  'factual_report',
  'survey',
  'adjudication',
  'investigation',
  'literature_review',
  'comparative',
  'how_to',
  'recommendation',
  'exploratory',
  'position_brief',
  'timeline',
  'reference_lookup',
  'story_verification',
  'opportunity_discovery',
  'feasibility',
  'implementation',
  'legacy',
]);

function isIntentId(s: unknown): s is IntentId {
  return typeof s === 'string' && INTENT_IDS.has(s);
}

/** Best-effort parse of classifier JSON into intent + confidence + reasoning. */
export function parseIntentClassifierJson(
  content: string,
  fallbackIntent: IntentId
): { intent: IntentId; confidence: number; reasoning: string } {
  try {
    const slice = extractJsonObject(content);
    if (!slice) throw new Error('no_json_object');
    const o = JSON.parse(slice) as Record<string, unknown>;
    const intent = isIntentId(o.intent) ? o.intent : fallbackIntent;
    const conf = typeof o.confidence === 'number' && Number.isFinite(o.confidence) ? o.confidence : 0.5;
    const reasoning = typeof o.reasoning === 'string' ? o.reasoning : 'Classifier returned non-text reasoning.';
    return { intent, confidence: Math.min(1, Math.max(0, conf)), reasoning };
  } catch (e) {
    logger.warn('plan_intent_classifier_json_parse_failed', { message: e instanceof Error ? e.message : String(e) });
    return { intent: fallbackIntent, confidence: 0.5, reasoning: 'Parser fallback — model output was not valid JSON.' };
  }
}

const VALID_EPISTEMIC_POSTURES = new Set<string>([
  'descriptive',
  'decision',
  'discovery',
  'adjudicative',
  'causal_test',
]);

function isEpistemicPosture(s: unknown): s is EpistemicPosture {
  return typeof s === 'string' && VALID_EPISTEMIC_POSTURES.has(s);
}

function coerceArtifact(raw: unknown): RequestedArtifact | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const description = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null;
  if (!description) return null;
  const exactCount = (() => {
    if (typeof o.exactCount !== 'number' || !Number.isFinite(o.exactCount)) return undefined;
    const rounded = Math.round(o.exactCount);
    return rounded > 0 ? rounded : undefined;
  })();
  const requiredFields = Array.isArray(o.requiredFields)
    ? o.requiredFields.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  return { description, exactCount, requiredFields: requiredFields.length > 0 ? requiredFields : undefined };
}

function coerceConstraint(raw: unknown): UserConstraint | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  const description = typeof o.description === 'string' && o.description.trim() ? o.description.trim() : null;
  if (!description) return null;
  return { description };
}

function parseResearchBriefOrUndefined(raw: unknown, fallbackIntent: IntentId): ResearchBrief | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const primaryIntent = isIntentId(o.primaryIntent) ? o.primaryIntent : fallbackIntent;
  const secondaryIntent =
    isIntentId(o.secondaryIntent) && o.secondaryIntent !== primaryIntent
      ? o.secondaryIntent
      : undefined;
  const requestedArtifacts = Array.isArray(o.requestedArtifacts)
    ? o.requestedArtifacts.map(coerceArtifact).filter((x): x is RequestedArtifact => x !== null)
    : [];
  const userConstraints = Array.isArray(o.userConstraints)
    ? o.userConstraints.map(coerceConstraint).filter((x): x is UserConstraint => x !== null)
    : [];
  const requestedFormats = Array.isArray(o.requestedFormats)
    ? o.requestedFormats.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : undefined;
  const epistemicPosture = isEpistemicPosture(o.epistemicPosture)
    ? o.epistemicPosture
    : (INTENT_EPISTEMIC_POSTURE[primaryIntent] ?? 'descriptive');
  const confidence =
    typeof o.confidence === 'number' && Number.isFinite(o.confidence)
      ? Math.min(1, Math.max(0, o.confidence))
      : 0.5;
  const reasoning =
    typeof o.reasoning === 'string' && o.reasoning.trim()
      ? o.reasoning.trim()
      : 'Research brief missing reasoning.';
  const resolvedMethodology =
    o.resolvedMethodology === 'standard' || o.resolvedMethodology === 'policyone'
      ? o.resolvedMethodology
      : resolveMethodologyFromIntent(primaryIntent);
  const requestedMethodology =
    o.requestedMethodology === 'auto' || o.requestedMethodology === 'standard' || o.requestedMethodology === 'policyone'
      ? o.requestedMethodology
      : 'auto';
  const methodologyResolutionSource =
    o.methodologyResolutionSource === 'user' || o.methodologyResolutionSource === 'triage' || o.methodologyResolutionSource === 'fallback'
      ? o.methodologyResolutionSource
      : 'fallback';
  const requestedResearchObjective =
    o.requestedResearchObjective === 'AUTO' || typeof o.requestedResearchObjective === 'string'
      ? (o.requestedResearchObjective as ResearchBrief['requestedResearchObjective'])
      : 'AUTO';
  const resolvedResearchObjective =
    typeof o.resolvedResearchObjective === 'string'
      ? (o.resolvedResearchObjective as ResearchBrief['resolvedResearchObjective'])
      : resolveObjectiveFromIntent(primaryIntent);
  const objectiveResolutionSource =
    o.objectiveResolutionSource === 'user' || o.objectiveResolutionSource === 'triage' || o.objectiveResolutionSource === 'fallback'
      ? o.objectiveResolutionSource
      : 'fallback';
  const objectiveResolutionReason =
    typeof o.objectiveResolutionReason === 'string' && o.objectiveResolutionReason.trim()
      ? o.objectiveResolutionReason.trim()
      : `Resolved from primary intent ${primaryIntent}.`;
  return {
    primaryIntent,
    requestedMethodology,
    resolvedMethodology,
    methodologyResolutionSource,
    secondaryIntent,
    requestedArtifacts,
    requestedFormats,
    userConstraints,
    epistemicPosture,
    confidence,
    reasoning,
    requestedResearchObjective,
    resolvedResearchObjective,
    objectiveResolutionSource,
    objectiveResolutionReason,
  };
}

/**
 * Phase B — parse the ResearchBrief JSON returned by RESEARCH_BRIEF_CLASSIFIER_PROMPT.
 * Falls back to a minimal brief using the provided defaults when the model returns
 * invalid or incomplete JSON.
 */
export function parseResearchBriefJson(
  content: string,
  fallbackIntent: IntentId
): ResearchBrief {
  try {
    const slice = extractJsonObject(content);
    if (!slice) throw new Error('no_json_object');
    const o = JSON.parse(slice) as Record<string, unknown>;

    const primaryIntent = isIntentId(o.primaryIntent) ? o.primaryIntent : fallbackIntent;
    const secondaryIntent =
      isIntentId(o.secondaryIntent) && o.secondaryIntent !== primaryIntent
        ? o.secondaryIntent
        : undefined;

    const requestedArtifacts = Array.isArray(o.requestedArtifacts)
      ? o.requestedArtifacts.map(coerceArtifact).filter((x): x is RequestedArtifact => x !== null)
      : [];

    const userConstraints = Array.isArray(o.userConstraints)
      ? o.userConstraints.map(coerceConstraint).filter((x): x is UserConstraint => x !== null)
      : [];
    const requestedFormats = Array.isArray(o.requestedFormats)
      ? o.requestedFormats.filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
      : undefined;

    const epistemicPosture = isEpistemicPosture(o.epistemicPosture)
      ? o.epistemicPosture
      : (INTENT_EPISTEMIC_POSTURE[primaryIntent] ?? 'descriptive');

    const confidence =
      typeof o.confidence === 'number' && Number.isFinite(o.confidence)
        ? Math.min(1, Math.max(0, o.confidence))
        : 0.5;

    const reasoning =
      typeof o.reasoning === 'string' && o.reasoning.trim()
        ? o.reasoning.trim()
        : 'Classifier returned non-text reasoning.';

    return {
      primaryIntent,
      requestedMethodology:
        o.requestedMethodology === 'auto' || o.requestedMethodology === 'standard' || o.requestedMethodology === 'policyone'
          ? o.requestedMethodology
          : 'auto',
      resolvedMethodology:
        o.resolvedMethodology === 'standard' || o.resolvedMethodology === 'policyone'
          ? o.resolvedMethodology
          : resolveMethodologyFromIntent(primaryIntent),
      methodologyResolutionSource:
        o.methodologyResolutionSource === 'user' || o.methodologyResolutionSource === 'triage' || o.methodologyResolutionSource === 'fallback'
          ? o.methodologyResolutionSource
          : 'fallback',
      secondaryIntent,
      requestedArtifacts,
      requestedFormats,
      userConstraints,
      epistemicPosture,
      confidence,
      reasoning,
      requestedResearchObjective:
        o.requestedResearchObjective === 'AUTO' || typeof o.requestedResearchObjective === 'string'
          ? (o.requestedResearchObjective as ResearchBrief['requestedResearchObjective'])
          : 'AUTO',
      resolvedResearchObjective:
        typeof o.resolvedResearchObjective === 'string'
          ? (o.resolvedResearchObjective as ResearchBrief['resolvedResearchObjective'])
          : resolveObjectiveFromIntent(primaryIntent),
      objectiveResolutionSource:
        o.objectiveResolutionSource === 'user' || o.objectiveResolutionSource === 'triage' || o.objectiveResolutionSource === 'fallback'
          ? o.objectiveResolutionSource
          : 'fallback',
      objectiveResolutionReason:
        typeof o.objectiveResolutionReason === 'string' && o.objectiveResolutionReason.trim()
          ? o.objectiveResolutionReason.trim()
          : `Resolved from primary intent ${primaryIntent}.`,
    };
  } catch (e) {
    logger.warn('research_brief_json_parse_failed', { message: e instanceof Error ? e.message : String(e) });
    return defaultResearchBrief(fallbackIntent, 0.5, 'Parser fallback — model output was not valid JSON.');
  }
}

function coercePlanPayload(raw: unknown, intentFallback: IntentId, confFallback: number): PlanPayload {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const intentObj = o.intent && typeof o.intent === 'object' ? (o.intent as Record<string, unknown>) : {};
  const id = isIntentId(intentObj.id) ? intentObj.id : intentFallback;
  const def = getIntentById(id);
  const displayLabel =
    typeof intentObj.displayLabel === 'string' && intentObj.displayLabel.trim()
      ? String(intentObj.displayLabel)
      : def?.displayLabel ?? id;
  const confidence =
    typeof intentObj.confidence === 'number' && Number.isFinite(intentObj.confidence)
      ? Math.min(1, Math.max(0, intentObj.confidence))
      : confFallback;
  const reasoning =
    typeof intentObj.reasoning === 'string' && intentObj.reasoning.trim()
      ? String(intentObj.reasoning)
      : 'Plan generator did not supply intent reasoning.';

  const topic = o.topicAnalysis && typeof o.topicAnalysis === 'object' ? (o.topicAnalysis as Record<string, unknown>) : {};
  const orch =
    o.orchestrationProfile && typeof o.orchestrationProfile === 'object'
      ? (o.orchestrationProfile as Record<string, unknown>)
      : {};
  const src = o.sourceStrategy && typeof o.sourceStrategy === 'object' ? (o.sourceStrategy as Record<string, unknown>) : {};
  const out = o.outputShape && typeof o.outputShape === 'object' ? (o.outputShape as Record<string, unknown>) : {};
  const est = o.estimatedCost && typeof o.estimatedCost === 'object' ? (o.estimatedCost as Record<string, unknown>) : {};

  const topicAnalysis = {
    summary: typeof topic.summary === 'string' ? topic.summary : 'Topic analysis unavailable.',
    isMultiLayer: Boolean(topic.isMultiLayer),
    isActivelyContested: Boolean(topic.isActivelyContested),
    competenceAssessment:
      typeof topic.competenceAssessment === 'string'
        ? topic.competenceAssessment
        : 'Competence assessment unavailable.',
  };

  const orchestrationProfile = {
    name: typeof orch.name === 'string' ? orch.name : 'wave5_placeholder_default',
    description: typeof orch.description === 'string' ? orch.description : 'Placeholder orchestration profile (Wave 5.2 wires real profiles).',
    agentsWillRun: Array.isArray(orch.agentsWillRun) ? orch.agentsWillRun.filter((x): x is string => typeof x === 'string') : [],
    agentsWillSkip: Array.isArray(orch.agentsWillSkip) ? orch.agentsWillSkip.filter((x): x is string => typeof x === 'string') : [],
  };

  const esc = src.expectedSourceCount && typeof src.expectedSourceCount === 'object' ? (src.expectedSourceCount as Record<string, unknown>) : {};
  const sourceStrategy = {
    summary: typeof src.summary === 'string' ? src.summary : 'Source strategy not specified.',
    weightedClasses: Array.isArray(src.weightedClasses)
      ? src.weightedClasses.filter((x): x is string => typeof x === 'string')
      : ['peer_reviewed', 'primary_documents'],
    expectedSourceCount: {
      min: typeof esc.min === 'number' && Number.isFinite(esc.min) ? Math.max(0, Math.floor(esc.min)) : 8,
      max: typeof esc.max === 'number' && Number.isFinite(esc.max) ? Math.max(0, Math.floor(esc.max)) : 40,
    },
  };

  const el = out.estimatedLength && typeof out.estimatedLength === 'object' ? (out.estimatedLength as Record<string, unknown>) : {};
  const outputShape = {
    structure: typeof out.structure === 'string' ? out.structure : 'Standard dossier sections.',
    estimatedLength: {
      minWords: typeof el.minWords === 'number' && Number.isFinite(el.minWords) ? Math.max(0, Math.floor(el.minWords)) : 1200,
      maxWords: typeof el.maxWords === 'number' && Number.isFinite(el.maxWords) ? Math.max(0, Math.floor(el.maxWords)) : 8000,
    },
    documentShape: typeof out.documentShape === 'string' ? out.documentShape : def?.documentShape ?? 'Structured report.',
  };

  const dur = est.durationSeconds && typeof est.durationSeconds === 'object' ? (est.durationSeconds as Record<string, unknown>) : {};
  const estimatedCost = {
    durationSeconds: {
      min: typeof dur.min === 'number' && Number.isFinite(dur.min) ? Math.max(0, Math.floor(dur.min)) : 60,
      max: typeof dur.max === 'number' && Number.isFinite(dur.max) ? Math.max(0, Math.floor(dur.max)) : 900,
    },
    estimatedTokens: typeof est.estimatedTokens === 'number' && Number.isFinite(est.estimatedTokens) ? Math.floor(est.estimatedTokens) : 50_000,
    estimatedCostCents:
      est.estimatedCostCents === null || est.estimatedCostCents === undefined
        ? null
        : typeof est.estimatedCostCents === 'number' && Number.isFinite(est.estimatedCostCents)
          ? Math.floor(est.estimatedCostCents)
          : null,
  };

  const briefFromPayload = parseResearchBriefOrUndefined(o.researchBrief, id);

  const base: PlanPayload = {
    requestedFormats: Array.isArray(o.requestedFormats) ? o.requestedFormats.filter((x): x is string => typeof x === 'string') : undefined,
    targetWordCount: typeof o.targetWordCount === 'number' && Number.isFinite(o.targetWordCount) ? Math.round(o.targetWordCount) : undefined,
    requestedMethodology: typeof o.requestedMethodology === 'string' ? o.requestedMethodology : briefFromPayload?.requestedMethodology,
    resolvedMethodology: typeof o.resolvedMethodology === 'string' ? o.resolvedMethodology : briefFromPayload?.resolvedMethodology,
    resolvedResearchObjective: typeof o.resolvedResearchObjective === 'string' ? o.resolvedResearchObjective : briefFromPayload?.resolvedResearchObjective,
    objectiveResolutionSource: typeof o.objectiveResolutionSource === 'string' ? o.objectiveResolutionSource : briefFromPayload?.objectiveResolutionSource,
    objectiveResolutionReason: typeof o.objectiveResolutionReason === 'string' ? o.objectiveResolutionReason : briefFromPayload?.objectiveResolutionReason,
    intent: { id, displayLabel, confidence, reasoning },
    topicAnalysis,
    orchestrationProfile,
    sourceStrategy,
    outputShape,
    estimatedCost,
    ...(briefFromPayload ? { researchBrief: briefFromPayload } : {}),
  };
  return mergePlanPayloadWithCanonicalProfile(base);
}

/** Coerce a JSONB / unknown blob from `research_plans.plan_payload` into `PlanPayload`. */
export function planPayloadFromUnknown(
  raw: unknown,
  intentFallback: IntentId,
  confFallback: number
): PlanPayload {
  return coercePlanPayload(raw, intentFallback, confFallback);
}

export function parsePlanGeneratorJson(
  content: string,
  intentFallback: IntentId,
  confFallback: number,
  researchBrief?: ResearchBrief
): PlanPayload {
  try {
    const slice = extractJsonObject(content);
    if (!slice) throw new Error('no_json_object');
    const o = JSON.parse(slice);
    const plan = coercePlanPayload(o, intentFallback, confFallback);
    return researchBrief ? mergePlanPayloadWithCanonicalProfile({ ...plan, researchBrief }) : plan;
  } catch (e) {
    logger.warn('plan_generator_json_parse_failed', { message: e instanceof Error ? e.message : String(e) });
    const def = getIntentById(intentFallback);
    const stub: PlanPayload = {
      intent: {
        id: intentFallback,
        displayLabel: def?.displayLabel ?? intentFallback,
        confidence: confFallback,
        reasoning: 'Plan generator returned invalid JSON — showing safe defaults.',
      },
      topicAnalysis: {
        summary: 'The planner produced unstructured output; review the query and refine the plan before running.',
        isMultiLayer: def?.isMultiLayer ?? true,
        isActivelyContested: false,
        competenceAssessment: 'Unknown — model output was not parseable.',
      },
      orchestrationProfile: {
        name: 'wave5_placeholder_default',
        description: 'Placeholder until Wave 5.2 profiles are wired.',
        agentsWillRun: ['planner', 'discovery', 'retrieval', 'reasoning', 'synthesis'],
        agentsWillSkip: [],
      },
      sourceStrategy: {
        summary: 'Balanced retrieval across peer-reviewed and primary materials where available.',
        weightedClasses: ['peer_reviewed', 'primary_documents'],
        expectedSourceCount: { min: 8, max: 40 },
      },
      outputShape: {
        structure: 'Executive summary → Evidence → Contradictions → Conclusions → Next steps',
        estimatedLength: { minWords: 1500, maxWords: 8000 },
        documentShape: def?.documentShape ?? 'Structured report.',
      },
      estimatedCost: {
        durationSeconds: { min: 120, max: 900 },
        estimatedTokens: 80_000,
        estimatedCostCents: null,
      },
    };
    return mergePlanPayloadWithCanonicalProfile(
      researchBrief ? { ...stub, researchBrief } : stub
    );
  }
}

export function parsePlanRefinementJson(
  content: string,
  currentPlan: PlanPayload
): { revisedPlan: PlanPayload; diffSummary: string; intentChange: { detected: boolean; from: IntentId | null; to: IntentId | null; rationale: string } } {
  try {
    const slice = extractJsonObject(content);
    if (!slice) throw new Error('no_json_object');
    const o = JSON.parse(slice) as Record<string, unknown>;
    const revisedRaw = o.revisedPlan;
    const revisedPlanRaw = coercePlanPayload(revisedRaw, currentPlan.intent.id, currentPlan.intent.confidence);
    const revisedPlan = mergePlanPayloadWithCanonicalProfile({
      ...revisedPlanRaw,
      researchBrief:
        revisedPlanRaw.researchBrief ??
        currentPlan.researchBrief ??
        defaultResearchBrief(currentPlan.intent.id, currentPlan.intent.confidence, currentPlan.intent.reasoning),
    });
    const diffSummary = typeof o.diffSummary === 'string' ? o.diffSummary : 'Refinement applied.';
    const icRaw = o.intentChange && typeof o.intentChange === 'object' ? (o.intentChange as Record<string, unknown>) : {};
    const from = isIntentId(icRaw.from) ? icRaw.from : currentPlan.intent.id;
    const to = isIntentId(icRaw.to) ? icRaw.to : revisedPlan.intent.id;
    const detected = Boolean(icRaw.detected) && from !== to;
    const rationale = typeof icRaw.rationale === 'string' ? icRaw.rationale : '';
    return { revisedPlan, diffSummary, intentChange: { detected, from, to, rationale } };
  } catch (e) {
    logger.warn('plan_refinement_json_parse_failed', { message: e instanceof Error ? e.message : String(e) });
    return {
      revisedPlan: currentPlan,
      diffSummary: 'Refinement model returned invalid JSON — plan unchanged.',
      intentChange: { detected: false, from: currentPlan.intent.id, to: currentPlan.intent.id, rationale: '' },
    };
  }
}

export { planSummaryFromPayload };
