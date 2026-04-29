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
 * Baseline models — Research One 2 matrix (verified live 2026-04-28).
 *
 * The binding rule (see `docs/V2_MODEL_SELECTION_CRITERIA.md`):
 * **inference-time behavior**, not training history. A V2 primary must,
 * under our `REASONING_FIRST_PREAMBLE` system prompt, NOT refuse,
 * sanitize, debunk-by-recall, or smooth over contradictions on
 * research-style queries about anomalous / suppressed claims.
 *
 * Three model categories pass the behavioral test in 2026 and are
 * therefore acceptable as V2 primaries:
 *
 *   (a) Open-weights "Thinking" / CoT reasoners with light RLHF —
 *       DeepSeek V3.x / R1-0528, Qwen3-235B Thinking, Kimi K2 Thinking.
 *       Admitted on critical-path roles. Multi-provider on OpenRouter.
 *   (b) Abliterated weights (refusal vector orthogonalized out) —
 *       `huihui-ai/*-abliterated`, `DavidAU/*-abliterated*`. Used as
 *       user-opt-in / emergency-sanity fallback.
 *   (c) Uncensored fine-tunes — `Dolphin*`, `Hermes-3` / `Hermes-4`,
 *       `Sao10K/Euryale*`. Required for adversarial roles
 *       (skeptic / internal_challenger).
 *
 * Operational constraints layered on top of the behavioral test:
 *
 *   1. **Multi-provider redundancy is mandatory** for critical-path
 *      defaults (planner / reasoner / synthesizer / utility / verifier).
 *      ≥ 2 live OpenRouter upstreams per slug. The 2026-04-28-PM outage
 *      was caused by routing every default through a single-upstream
 *      slug (Nebius-only `nousresearch/hermes-4-70b`).
 *   2. **Adversarial roles** can use single-provider uncensored
 *      fine-tunes because their failures are recoverable mid-pipeline.
 *   3. **Forbidden as default**: closed-API moderation pipelines
 *      (Anthropic / OpenAI / Google / Mistral closed) and heavy-RLHF
 *      instruct bases without abliteration (`meta-llama/*-Instruct`,
 *      `Qwen/*-Instruct`, unabliterated `DeepSeek-R1-Distill-Llama-70B`,
 *      `Qwen/QwQ-32B-Preview`). They remain user-opt-in fallback only.
 *
 * Verified 2026-04-28 against `https://openrouter.ai/api/v1/models/<slug>/endpoints`.
 */
const V2M = {
  /**
   * DeepSeek V3.2 (open-weights, 685B). 11 OpenRouter upstreams (Baidu,
   * SiliconFlow, DeepInfra, AtlasCloud, Novita, Chutes, Parasail,
   * Friendli, Google, Alibaba), 100% uptime. DeepSeek's published RLHF
   * is reasoning-focused, *not* refusal-focused; under our reasoning-
   * first preamble it follows the operator role rather than refusing.
   * Default planner / synthesizer / utility role — the workhorse.
   */
  DEEPSEEK_V32: 'deepseek/deepseek-v3.2',
  /**
   * DeepSeek V3.1 (open-weights). 11 OpenRouter upstreams. Used as the
   * fallback for V3.2 when V3.2 is rate-limited or unavailable. Same
   * low-refusal profile.
   */
  DEEPSEEK_V31: 'deepseek/deepseek-chat-v3.1',
  /**
   * DeepSeek R1-0528 (open-weights, reasoner-class with explicit CoT).
   * 5 OpenRouter upstreams (DeepInfra, SiliconFlow, AtlasCloud, Novita,
   * Together), 100% uptime. Default reasoner / change_planner.
   */
  DEEPSEEK_R1: 'deepseek/deepseek-r1-0528',
  /**
   * Qwen3-235B-A22B-Thinking-2507 (open-weights, MoE reasoner). 4
   * OpenRouter upstreams (Alibaba, DeepInfra, AtlasCloud, Novita), 100%
   * uptime. Used as the reasoner fallback. Qwen Thinking line is
   * reasoning-focused and noticeably less refusal-aligned than the
   * `Qwen/*-Instruct` chat line.
   */
  QWEN_THINKING: 'qwen/qwen3-235b-a22b-thinking-2507',
  /**
   * Kimi K2 Thinking (Moonshot AI, open-weights reasoner). 3 OpenRouter
   * upstreams (Novita, Google, AtlasCloud), 100% uptime. Used as the
   * planner / change_planner fallback because Kimi K2's reasoning style
   * complements R1's.
   */
  KIMI_K2_THINKING: 'moonshotai/kimi-k2-thinking',
  /**
   * Dolphin Mistral 24B Venice Edition (Cognitive Computations,
   * uncensored fine-tune). Single-provider on OpenRouter (Venice). Used
   * as the primary skeptic / internal_challenger across all objectives
   * because its training explicitly drops the "decline anomalies"
   * objective. Acceptable single-provider risk for adversarial roles
   * per criterion 3.
   */
  DOLPHIN_VENICE: 'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  /**
   * Sao10K L3.3 Euryale 70B (uncensored Llama-3.3-70B fine-tune). 2
   * OpenRouter upstreams (NextBit, DeepInfra). Used as the skeptic
   * fallback and as the primary on the anomaly objective.
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
  // All utility roles default to DeepSeek V3.2 (11 upstream providers,
  // 100% uptime, low-refusal under our reasoning-first preamble),
  // falling back to V3.1 (also 11 providers) on rate limit.
  retriever: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
  verifier: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
  citation_integrity_checker: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
  revision_intake: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
  report_locator: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
  final_revision_verifier: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
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
 * Critical-path roles (planner / reasoner / synthesizer / utility /
 * verifier) use multi-provider DeepSeek / Qwen-Thinking / Kimi-Thinking
 * primaries so a single account-policy mismatch can never block a run.
 * Adversarial roles (skeptic / internal_challenger) stay on uncensored
 * fine-tunes (Dolphin Venice / Sao10K Euryale) per the binding
 * `docs/V2_MODEL_SELECTION_CRITERIA.md` rules.
 *
 * Fallbacks only fire when the user explicitly opts in per role from
 * the V2 UI.
 */
export const V2_MODE_PRESETS: Record<ResearchObjective, Record<ReasoningModelRole, RoleModelPair>> = {
  GENERAL_EPISTEMIC_RESEARCH: v2Mode({
    planner: pair(V2M.DEEPSEEK_V32, V2M.KIMI_K2_THINKING),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    outline_architect: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_drafter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    coherence_refiner: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    plain_language_synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_rewriter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  INVESTIGATIVE_SYNTHESIS: v2Mode({
    planner: pair(V2M.DEEPSEEK_V32, V2M.KIMI_K2_THINKING),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    outline_architect: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_drafter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    coherence_refiner: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    plain_language_synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_rewriter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  PATENT_GAP_ANALYSIS: v2Mode({
    planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    outline_architect: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_drafter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    synthesizer: pair(V2M.DEEPSEEK_R1, V2M.DEEPSEEK_V32),
    coherence_refiner: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    plain_language_synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_rewriter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  NOVEL_APPLICATION_DISCOVERY: v2Mode({
    planner: pair(V2M.KIMI_K2_THINKING, V2M.DEEPSEEK_V32),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    outline_architect: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_drafter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    coherence_refiner: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    plain_language_synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_rewriter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    skeptic: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
    internal_challenger: pair(V2M.DOLPHIN_VENICE, V2M.EURYALE_70B),
  }),

  ANOMALY_CORRELATION: v2Mode({
    // Anomaly objective leans into Euryale on the skeptic side and uses
    // R1 + Qwen Thinking for the reasoner ladder.
    planner: pair(V2M.DEEPSEEK_V32, V2M.KIMI_K2_THINKING),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWEN_THINKING),
    outline_architect: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_drafter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    coherence_refiner: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    plain_language_synthesizer: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
    section_rewriter: pair(V2M.DEEPSEEK_V32, V2M.DEEPSEEK_V31),
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
 * Per-run UI overrides win over preset primary when non-empty.
 * Preset fallback always fires. `allowFallbackForRole` only controls whether
 * a user-supplied runtime override fallback (set from the V2 UI) replaces it.
 */
export function mergePresetWithRuntimeOverride(
  preset: { primary: string; fallback?: string },
  runtime: { primary?: string; fallback?: string } | undefined,
  allowFallbackForRole: boolean
): { primary: string; fallback?: string } {
  const p = runtime?.primary?.trim();
  // Runtime override fallback only applies when the user has opted in.
  // The preset fallback is always the base — it fires unconditionally.
  const f = allowFallbackForRole ? runtime?.fallback?.trim() : undefined;
  return {
    primary: p || preset.primary,
    fallback: f !== undefined && f !== '' ? f : preset.fallback,
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

  // Preset-level fallback always fires at the model-call level.
  // `allowFallbackForRole` only controls whether the user's runtime override
  // fallback (set in the V2 UI) can replace the preset fallback.
  // This ensures any primary outage automatically retries the preset fallback
  // without requiring per-role user opt-in — the gap that caused ongoing
  // V2 failures even after PR #41 fixed multi-provider routing.
  return { ...presetForRole };
}
