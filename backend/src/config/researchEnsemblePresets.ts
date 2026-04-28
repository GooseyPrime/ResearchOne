import {
  REASONING_MODEL_ROLES,
  type ReasoningModelRole,
  type ResearchObjective,
  RESEARCH_OBJECTIVES,
  APPROVED_REASONING_MODEL_ALLOWLIST,
  type ModelCallPurpose,
} from '../services/reasoning/reasoningModelPolicy';
import { CODE_DEFAULT_REASONING_FALLBACKS, CODE_DEFAULT_REASONING_MODELS } from './defaultModels';

export type RoleModelPair = { primary: string; fallback: string };

function pair(primary: string, fallback: string): RoleModelPair {
  return { primary, fallback };
}

/** Maps config camelCase keys to ReasoningModelRole snake_case keys. */
const CONFIG_TO_ROLE: Record<string, ReasoningModelRole> = {
  planner: 'planner',
  retriever: 'retriever',
  reasoner: 'reasoner',
  skeptic: 'skeptic',
  synthesizer: 'synthesizer',
  verifier: 'verifier',
  plainLanguageSynthesizer: 'plain_language_synthesizer',
  outlineArchitect: 'outline_architect',
  sectionDrafter: 'section_drafter',
  internalChallenger: 'internal_challenger',
  coherenceRefiner: 'coherence_refiner',
  revisionIntake: 'revision_intake',
  reportLocator: 'report_locator',
  changePlanner: 'change_planner',
  sectionRewriter: 'section_rewriter',
  citationIntegrityChecker: 'citation_integrity_checker',
  finalRevisionVerifier: 'final_revision_verifier',
};

function fromCodeDefaults(): Record<ReasoningModelRole, RoleModelPair> {
  const out = {} as Record<ReasoningModelRole, RoleModelPair>;
  for (const [ck, role] of Object.entries(CONFIG_TO_ROLE)) {
    const pk = ck as keyof typeof CODE_DEFAULT_REASONING_MODELS;
    if (!(pk in CODE_DEFAULT_REASONING_FALLBACKS)) continue;
    const fk = pk as keyof typeof CODE_DEFAULT_REASONING_FALLBACKS;
    out[role] = pair(CODE_DEFAULT_REASONING_MODELS[pk], CODE_DEFAULT_REASONING_FALLBACKS[fk]);
  }
  for (const role of REASONING_MODEL_ROLES) {
    if (!out[role]) {
      throw new Error(`fromCodeDefaults: missing role "${role}"`);
    }
  }
  return out;
}

/** OpenRouter / HF ids — tuned per research objective (V1 ensembles). */
const M = {
  opus: 'anthropic/claude-opus-4.7',
  sonnet45: 'anthropic/claude-sonnet-4.5',
  sonnet4: 'anthropic/claude-sonnet-4',
  haiku: 'anthropic/claude-3.5-haiku',
  o3: 'openai/o3',
  o4mini: 'openai/o4-mini',
  o3mini: 'openai/o3-mini',
  gpt5mini: 'openai/gpt-5-mini',
  r1: 'deepseek/deepseek-r1',
  v32: 'deepseek/deepseek-v3.2',
  kimi: 'moonshotai/kimi-k2-thinking',
  geminiPro: 'google/gemini-2.5-pro',
  geminiFlash: 'google/gemini-2.5-flash',
  mistral: 'mistralai/mistral-small-3.2-24b-instruct',
  llama70: 'meta-llama/llama-3.3-70b-instruct',
  qwen: 'qwen/qwen3-235b-a22b',
  hermes: 'NousResearch/Hermes-3-Llama-3.1-70B',
  // V1 carry-over: the model used to be hosted at
  // `cognitivecomputations/dolphin-2.9.2-qwen2-72b`, but HF renamed it
  // upstream to `dphn/dolphin-2.9.2-qwen2-72b`. The 2026-04-28 PR #40
  // review (Copilot) flagged that the new `isHfRepoModel` no longer
  // routes the legacy slug through HF, which would silently send V1
  // calls to OpenRouter where this slug does not exist. Move V1 to the
  // current upstream slug so the route stays HF.
  dolphin: 'dphn/dolphin-2.9.2-qwen2-72b',
} as const;

function mergePreset(
  base: Record<ReasoningModelRole, RoleModelPair>,
  patch: Partial<Record<ReasoningModelRole, RoleModelPair>>
): Record<ReasoningModelRole, RoleModelPair> {
  const out = { ...base };
  for (const role of REASONING_MODEL_ROLES) {
    if (patch[role]) out[role] = patch[role]!;
  }
  return out;
}

const BASE_GENERAL = fromCodeDefaults();

/**
 * Five default ensembles (one per ResearchObjective) — V1 / non-V2 flows.
 */
export const ENSEMBLE_PRESETS: Record<ResearchObjective, Record<ReasoningModelRole, RoleModelPair>> = {
  GENERAL_EPISTEMIC_RESEARCH: BASE_GENERAL,

  INVESTIGATIVE_SYNTHESIS: mergePreset(BASE_GENERAL, {
    planner: pair(M.kimi, M.r1),
    reasoner: pair(M.opus, M.r1),
    synthesizer: pair(M.opus, M.sonnet45),
    verifier: pair(M.sonnet4, M.o3mini),
    outline_architect: pair(M.kimi, M.geminiPro),
    section_drafter: pair(M.geminiPro, M.sonnet4),
    coherence_refiner: pair(M.sonnet45, M.geminiPro),
    plain_language_synthesizer: pair(M.haiku, M.geminiFlash),
    skeptic: pair(M.hermes, M.dolphin),
    internal_challenger: pair(M.hermes, M.dolphin),
    retriever: pair(M.v32, M.geminiFlash),
  }),

  NOVEL_APPLICATION_DISCOVERY: mergePreset(BASE_GENERAL, {
    planner: pair(M.opus, M.kimi),
    reasoner: pair(M.opus, M.o3),
    synthesizer: pair(M.opus, M.sonnet45),
    outline_architect: pair(M.opus, M.kimi),
    section_drafter: pair(M.opus, M.geminiPro),
    coherence_refiner: pair(M.opus, M.sonnet45),
    plain_language_synthesizer: pair(M.sonnet45, M.haiku),
    skeptic: pair(M.hermes, M.dolphin),
    internal_challenger: pair(M.hermes, M.dolphin),
    retriever: pair(M.v32, M.geminiFlash),
    verifier: pair(M.o4mini, M.o3mini),
  }),

  PATENT_GAP_ANALYSIS: mergePreset(BASE_GENERAL, {
    planner: pair(M.o3, M.r1),
    reasoner: pair(M.o3, M.r1),
    retriever: pair(M.o4mini, M.geminiFlash),
    verifier: pair(M.o4mini, M.o3mini),
    synthesizer: pair(M.sonnet45, M.geminiPro),
    outline_architect: pair(M.kimi, M.o3),
    section_drafter: pair(M.geminiPro, M.sonnet4),
    skeptic: pair(M.hermes, M.dolphin),
    internal_challenger: pair(M.hermes, M.dolphin),
    citation_integrity_checker: pair(M.o4mini, M.mistral),
    plain_language_synthesizer: pair(M.haiku, M.geminiFlash),
  }),

  ANOMALY_CORRELATION: mergePreset(BASE_GENERAL, {
    planner: pair(M.kimi, M.opus),
    reasoner: pair(M.r1, M.o3),
    synthesizer: pair(M.sonnet45, M.opus),
    skeptic: pair(M.hermes, M.dolphin),
    internal_challenger: pair(M.dolphin, M.hermes),
    retriever: pair(M.v32, M.o4mini),
    verifier: pair(M.sonnet4, M.o4mini),
    outline_architect: pair(M.kimi, M.r1),
    section_drafter: pair(M.geminiPro, M.sonnet45),
    coherence_refiner: pair(M.sonnet45, M.geminiPro),
  }),
};

/**
 * Baseline models — Research One 2 strict uncensored / steerable matrix.
 *
 * V2 selection criteria (see `docs/V2_MODEL_SELECTION_CRITERIA.md` for the full
 * rationale and `ResearchOne PolicyOne` for the epistemic policy these
 * selections must serve):
 *
 *   1. NO refusal-aligned primary models. RLHF/RLAIF safety post-training
 *      drives the model toward "I cannot help with that," consensus debunking,
 *      and silent omission of suppressed-knowledge claims.
 *   2. PRIMARY models for every V2 role must be either:
 *        - abliterated (refusal direction orthogonalized out); or
 *        - uncensored fine-tunes (Dolphin / Hermes / Euryale lines that
 *          were trained without the "decline anomalies" objective); or
 *        - steerable, low-refusal open weights that follow operator system
 *          prompts as authority.
 *   3. PRIMARY routing must be multi-provider redundant. After the
 *      2026-04-28 V2 outage (every V2 primary was single-provider on HF
 *      Inference: featherless-ai), V2 defaults route through OpenRouter,
 *      which fans out across multiple upstream providers per model. HF
 *      Inference Providers is still allowlisted for user-opt-in routing.
 *   4. Adversarial roles (skeptic / internal_challenger) use the most
 *      uncensored slot so red-team critique can attack mainstream
 *      consensus directly without alignment dampening.
 */
const V2M = {
  /**
   * Hermes 4 70B (Nous Research). Steerable, neutrally-aligned long-form
   * model with strong instruction following. OpenRouter-routed, multi-provider.
   */
  HERMES_4: 'nousresearch/hermes-4-70b',
  /**
   * Hermes 4 405B (Nous Research). The reasoner-class steerable model.
   * OpenRouter-routed, multi-provider.
   */
  HERMES_4_405B: 'nousresearch/hermes-4-405b',
  /**
   * Hermes 3 70B (Nous Research, OpenRouter slug). Multi-provider on
   * OpenRouter. Used for utility roles (verifier, retriever, locator) where
   * 70B-class steering capacity is sufficient.
   */
  HERMES_3_70B: 'nousresearch/hermes-3-llama-3.1-70b',
  /**
   * Hermes 3 405B (Nous Research, OpenRouter slug). Used as a 405B fallback
   * for the reasoner / change_planner roles when Hermes 4 405B is rate-limited.
   */
  HERMES_3_405B: 'nousresearch/hermes-3-llama-3.1-405b',
  /**
   * Dolphin Mistral 24B Venice Edition (Cognitive Computations,
   * OpenRouter slug `:free`). Uncensored fine-tune of Mistral Small 24B
   * trained without the decline-anomalies objective. Primary skeptic /
   * internal_challenger across all objectives.
   */
  DOLPHIN_VENICE: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  /**
   * Sao10K L3.3 Euryale 70B (OpenRouter slug). Uncensored Llama-3.3-70B
   * long-form fine-tune used for adversarial / anomaly red-team fallback.
   */
  EURYALE_70B: 'sao10k/l3.3-euryale-70b',
} as const;

const V2_UTILITIES: Record<
  | 'retriever'
  | 'verifier'
  | 'citation_integrity_checker'
  | 'revision_intake'
  | 'report_locator'
  | 'final_revision_verifier',
  RoleModelPair
> = {
  // All utility roles default to Hermes 3 70B (steerable, multi-provider on
  // OpenRouter), with Hermes 4 70B as the user-opt-in fallback.
  retriever: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
  verifier: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
  citation_integrity_checker: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
  revision_intake: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
  report_locator: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
  final_revision_verifier: pair(V2M.HERMES_3_70B, V2M.HERMES_4),
};

function v2Mode(
  core: Omit<
    Record<ReasoningModelRole, RoleModelPair>,
    keyof typeof V2_UTILITIES
  >
): Record<ReasoningModelRole, RoleModelPair> {
  return { ...core, ...V2_UTILITIES };
}

/**
 * Research One 2 — strict architecture-aligned presets.
 *
 * Every primary in every objective is uncensored / steerable open-weights,
 * routed through OpenRouter for multi-provider redundancy, per the V2
 * selection criteria above and the `ResearchOne PolicyOne` epistemic policy.
 * Fallbacks are also drawn from the same pool — fallbacks only fire when
 * the user explicitly opts in per role from the V2 UI.
 */
export const V2_MODE_PRESETS: Record<ResearchObjective, Record<ReasoningModelRole, RoleModelPair>> = {
  GENERAL_EPISTEMIC_RESEARCH: v2Mode({
    planner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    reasoner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    change_planner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    outline_architect: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    section_drafter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    synthesizer: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    coherence_refiner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3_70B, V2M.DOLPHIN_VENICE),
    section_rewriter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  INVESTIGATIVE_SYNTHESIS: v2Mode({
    planner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    reasoner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    change_planner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    outline_architect: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    section_drafter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    synthesizer: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    coherence_refiner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3_70B, V2M.DOLPHIN_VENICE),
    section_rewriter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  PATENT_GAP_ANALYSIS: v2Mode({
    planner: pair(V2M.HERMES_4_405B, V2M.HERMES_4),
    reasoner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    change_planner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    outline_architect: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    section_drafter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    synthesizer: pair(V2M.HERMES_4_405B, V2M.HERMES_4),
    coherence_refiner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3_70B, V2M.DOLPHIN_VENICE),
    section_rewriter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  NOVEL_APPLICATION_DISCOVERY: v2Mode({
    planner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    reasoner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    change_planner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    outline_architect: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    section_drafter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    synthesizer: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    coherence_refiner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3_70B, V2M.DOLPHIN_VENICE),
    section_rewriter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  ANOMALY_CORRELATION: v2Mode({
    // Anomaly objective leans into the most uncensored chain on the
    // skeptic side. Hermes-line still drives synthesis where structure
    // matters.
    planner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    reasoner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    change_planner: pair(V2M.HERMES_4_405B, V2M.HERMES_3_405B),
    outline_architect: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    section_drafter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    synthesizer: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    coherence_refiner: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3_70B, V2M.DOLPHIN_VENICE),
    section_rewriter: pair(V2M.HERMES_4, V2M.HERMES_3_70B),
    skeptic: pair(V2M.EURYALE_70B, V2M.DOLPHIN_VENICE),
    internal_challenger: pair(V2M.EURYALE_70B, V2M.DOLPHIN_VENICE),
  }),
};

export function validateEnsemblePresetsAgainstAllowlist(): void {
  for (const obj of RESEARCH_OBJECTIVES) {
    const preset = ENSEMBLE_PRESETS[obj];
    for (const role of REASONING_MODEL_ROLES) {
      const { primary, fallback } = preset[role];
      const allowed = APPROVED_REASONING_MODEL_ALLOWLIST[role];
      if (!allowed.includes(primary)) {
        throw new Error(`ENSEMBLE_PRESETS[${obj}].${role} primary "${primary}" not in allowlist`);
      }
      if (!allowed.includes(fallback)) {
        throw new Error(`ENSEMBLE_PRESETS[${obj}].${role} fallback "${fallback}" not in allowlist`);
      }
    }
  }
}

export function validateV2ModePresetsAgainstAllowlist(): void {
  for (const obj of RESEARCH_OBJECTIVES) {
    const preset = V2_MODE_PRESETS[obj];
    for (const role of REASONING_MODEL_ROLES) {
      const { primary, fallback } = preset[role];
      const allowed = APPROVED_REASONING_MODEL_ALLOWLIST[role];
      if (!allowed.includes(primary)) {
        throw new Error(`V2_MODE_PRESETS[${obj}].${role} primary "${primary}" not in allowlist`);
      }
      if (!allowed.includes(fallback)) {
        throw new Error(`V2_MODE_PRESETS[${obj}].${role} fallback "${fallback}" not in allowlist`);
      }
    }
  }
}

/**
 * Per-run UI overrides win over preset primary/fallback when non-empty.
 * When `allowFallbackForRole` is false, preset and runtime fallbacks are omitted.
 */
export function mergePresetWithRuntimeOverride(
  preset: { primary: string; fallback?: string },
  runtime: { primary?: string; fallback?: string } | undefined,
  allowFallbackForRole: boolean
): { primary: string; fallback?: string } {
  const p = runtime?.primary?.trim();
  const f = allowFallbackForRole ? runtime?.fallback?.trim() : undefined;
  const presetFb = allowFallbackForRole ? preset.fallback : undefined;
  return {
    primary: p || preset.primary,
    fallback: f !== undefined && f !== '' ? f : presetFb,
  };
}

export function resolveReasoningModels(args: {
  engineVersion?: string | null;
  researchObjective?: ResearchObjective | null;
  role: ReasoningModelRole;
  callPurpose?: ModelCallPurpose;
  /** When true, V2 preset may include fallback for this role (per-role opt-in from overrides). */
  allowFallbackForRole?: boolean | null;
}): { primary: string; fallback?: string } | null {
  if (!args.engineVersion || args.engineVersion.trim() !== 'v2') return null;

  const obj = args.researchObjective ?? 'GENERAL_EPISTEMIC_RESEARCH';
  const { role } = args;
  const allowFallbackForRole = args.allowFallbackForRole === true;

  const presetForObjective = V2_MODE_PRESETS[obj] ?? V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH;
  const presetForRole = presetForObjective[role];
  const resolvedConfig: { primary: string; fallback?: string } = { ...presetForRole };

  if (!allowFallbackForRole) {
    delete resolvedConfig.fallback;
  }

  return resolvedConfig;
}
