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
  dolphin: 'cognitivecomputations/dolphin-2.9.2-qwen2-72b',
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
 * Baseline models — Research One 2 strict uncensored open-weights matrix.
 *
 * V2 selection criteria (see `docs/V2_MODEL_SELECTION_CRITERIA.md` for the full
 * rationale and `ResearchOne PolicyOne` for the epistemic policy these
 * selections must serve):
 *
 *   1. NO refusal-aligned primary models. RLHF/RLAIF safety post-training
 *      drives the model toward "I cannot help with that," consensus debunking,
 *      and silent omission of suppressed-knowledge claims. That is the
 *      contaminated-corpus drift the policy explicitly forbids.
 *   2. PRIMARY models for every V2 role must be either:
 *        - abliterated (refusal direction orthogonalized out — same base
 *          weights with the refusal feature direction removed); or
 *        - uncensored fine-tunes (Dolphin / Hermes / Dark-Champion lines that
 *          were trained without the "decline anomalies" objective); or
 *        - steerable, low-refusal open weights with intact long-form +
 *          reasoning capability.
 *   3. Reasoning chains MUST be preserved. The reasoner role uses an
 *      abliterated DeepSeek R1 distill so we keep R1-style step-by-step
 *      reasoning *without* the Llama refusal head sitting on top of it.
 *   4. No closed-source / API-gated routing on V2 utility primaries. V2
 *      stays on HF-hostable open-weights so we are not dependent on a
 *      moderation pipeline we do not control.
 *   5. Adversarial roles (skeptic / internal_challenger) prefer the most
 *      uncensored slot (Dolphin / Dark-Champion) so red-team critique can
 *      attack mainstream consensus directly without alignment dampening.
 *
 * If a V2 model becomes unavailable on HF Inference Providers we surface
 * the failure as `provider_unavailable` and (per the same plan)
 * `aborted` once the retry budget is exhausted. We do NOT silently swap
 * to a refusal-aligned primary as a "more reliable" substitute — that
 * would be exactly the policy violation this matrix exists to prevent.
 */
const V2M = {
  /**
   * Hermes-3-Llama-3.1-70B (Nous Research). Steerable, low-refusal,
   * neutrally-aligned long-form model. Used across drafting / synthesis /
   * coherence / locator / rewriter roles.
   */
  HERMES_3: 'NousResearch/Hermes-3-Llama-3.1-70B',
  /**
   * DeepHermes-3-Llama-3-8B-Preview (Nous Research). Open-reasoning preview
   * with neutral alignment and chain-of-thought capability; used as a
   * smaller fallback where speed matters and refusal-free behavior is still
   * required.
   */
  DEEP_HERMES_3: 'NousResearch/DeepHermes-3-Llama-3-8B-Preview',
  /**
   * Dolphin-2.9.2 on Qwen2-72B base (Cognitive Computations). Uncensored
   * long-form fine-tune. Primary for skeptic / internal_challenger.
   */
  DOLPHIN_QWEN: 'cognitivecomputations/dolphin-2.9.2-qwen2-72b',
  /**
   * Dolphin 3.0 on Llama-3.1-70B base (Cognitive Computations). Newer
   * uncensored long-form line; used as adversarial / synthesis fallback.
   */
  DOLPHIN_3_70B: 'cognitivecomputations/Dolphin3.0-Llama3.1-70B',
  /**
   * Dark-Champion 8x3B MoE (DavidAU). Abliterated MoE optimized for
   * adversarial / anomaly red-teaming.
   */
  DARK_CHAMPION:
    'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  /**
   * Abliterated Llama-3.3-70B-Instruct (huihui-ai). Same Meta base weights
   * with the refusal direction orthogonalized out. Use this in place of the
   * RLHF-aligned `meta-llama/Llama-3.3-70B-Instruct`. Capability profile is
   * preserved (instruction following, long context, tool use); the refusal
   * head is gone.
   */
  ABLIT_LLAMA_70B: 'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  /**
   * Abliterated Qwen2.5-72B-Instruct (huihui-ai). Same Qwen base weights
   * minus the refusal direction. Used where Qwen's structured-output
   * fidelity matters (retriever JSON output, long-form synthesis on patent
   * gap analysis) without the Qwen alignment filter.
   */
  ABLIT_QWEN_72B: 'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
  /**
   * Abliterated DeepSeek-R1-Distill-Llama-70B (huihui-ai). R1-style
   * chain-of-thought reasoning with the Llama refusal direction removed.
   * Reasoner / change_planner primary — we keep R1 reasoning fidelity
   * without the closed-corpus consensus debunking pattern.
   */
  ABLIT_R1_70B: 'huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated',
  /**
   * Non-abliterated DeepSeek-R1-Distill-Llama-70B (DeepSeek). Reasoning
   * fidelity is intact but Llama RLHF refusal head is still attached. We
   * keep this on the V2 allowlist as a *user-opt-in* fallback only — the
   * primary path stays on `ABLIT_R1_70B`.
   */
  R1_DISTILL_70B: 'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
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
  // Retriever needs JSON-clean output → abliterated Qwen 72B (Qwen's
  // structured-output strength minus the alignment filter).
  retriever: pair(V2M.ABLIT_QWEN_72B, V2M.ABLIT_LLAMA_70B),
  // Verification roles need calibrated long-form judgement without refusal.
  verifier: pair(V2M.ABLIT_LLAMA_70B, V2M.HERMES_3),
  citation_integrity_checker: pair(V2M.ABLIT_LLAMA_70B, V2M.HERMES_3),
  revision_intake: pair(V2M.ABLIT_LLAMA_70B, V2M.HERMES_3),
  report_locator: pair(V2M.ABLIT_LLAMA_70B, V2M.HERMES_3),
  final_revision_verifier: pair(V2M.ABLIT_LLAMA_70B, V2M.HERMES_3),
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
 * Every primary in every objective is uncensored / abliterated / steerable
 * open-weights, per the V2 selection criteria above and the
 * `ResearchOne PolicyOne` epistemic policy. Fallbacks are also drawn from
 * the same pool — fallbacks only fire when the user explicitly opts in
 * per role from the V2 UI.
 */
export const V2_MODE_PRESETS: Record<ResearchObjective, Record<ReasoningModelRole, RoleModelPair>> = {
  GENERAL_EPISTEMIC_RESEARCH: v2Mode({
    planner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    reasoner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    change_planner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    outline_architect: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    section_drafter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    synthesizer: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    coherence_refiner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.DEEP_HERMES_3),
    section_rewriter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  INVESTIGATIVE_SYNTHESIS: v2Mode({
    planner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    reasoner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    change_planner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    outline_architect: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    section_drafter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    synthesizer: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    coherence_refiner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.DEEP_HERMES_3),
    section_rewriter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  PATENT_GAP_ANALYSIS: v2Mode({
    // Patent / structured-claim work benefits from Qwen's structured output
    // strength — but we use the abliterated Qwen variant so claim
    // extraction is not silently filtered against anomalous prior art.
    planner: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    reasoner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    change_planner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    outline_architect: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    section_drafter: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    synthesizer: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    coherence_refiner: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.DEEP_HERMES_3),
    section_rewriter: pair(V2M.ABLIT_QWEN_72B, V2M.HERMES_3),
    skeptic: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
    internal_challenger: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
  }),

  NOVEL_APPLICATION_DISCOVERY: v2Mode({
    planner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    reasoner: pair(V2M.HERMES_3, V2M.ABLIT_R1_70B),
    change_planner: pair(V2M.HERMES_3, V2M.ABLIT_R1_70B),
    outline_architect: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    section_drafter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    synthesizer: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    coherence_refiner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.DEEP_HERMES_3),
    section_rewriter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  ANOMALY_CORRELATION: v2Mode({
    // Anomaly objective leans into the most uncensored / steerable chain.
    planner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    reasoner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    change_planner: pair(V2M.ABLIT_R1_70B, V2M.HERMES_3),
    outline_architect: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    section_drafter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    synthesizer: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    coherence_refiner: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.DEEP_HERMES_3),
    section_rewriter: pair(V2M.HERMES_3, V2M.ABLIT_LLAMA_70B),
    skeptic: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
    internal_challenger: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
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
