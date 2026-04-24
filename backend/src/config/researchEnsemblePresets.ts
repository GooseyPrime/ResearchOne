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

/** Baseline models — Research One 2 strict open-weights matrix. */
const V2M = {
  LLAMA_3_3: 'meta-llama/Llama-3.3-70B-Instruct',
  DEEPSEEK_R1: 'deepseek/deepseek-r1',
  DOLPHIN_QWEN: 'cognitivecomputations/dolphin-2.9.2-qwen2-72b',
  DARK_CHAMPION:
    'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  HERMES_3: 'NousResearch/Hermes-3-Llama-3.1-70B',
  QWEN_72B: 'qwen/qwen2.5-72b-instruct',
  FAST_UTILITY: 'qwen/qwen2.5-32b-instruct',
  FAST_FALLBACK: 'qwen/qwen2.5-14b-instruct',
  QWQ: 'Qwen/QwQ-32B-Preview',
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
  retriever: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
  verifier: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
  citation_integrity_checker: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
  revision_intake: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
  report_locator: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
  final_revision_verifier: pair(V2M.FAST_UTILITY, V2M.FAST_FALLBACK),
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
 * Research One 2 — strict architecture-aligned presets (open-weights only).
 */
export const V2_MODE_PRESETS: Record<ResearchObjective, Record<ReasoningModelRole, RoleModelPair>> = {
  GENERAL_EPISTEMIC_RESEARCH: v2Mode({
    planner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    outline_architect: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_drafter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    coherence_refiner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    plain_language_synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_rewriter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  INVESTIGATIVE_SYNTHESIS: v2Mode({
    planner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    outline_architect: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_drafter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    coherence_refiner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    plain_language_synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_rewriter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  PATENT_GAP_ANALYSIS: v2Mode({
    planner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.QWQ),
    outline_architect: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    section_drafter: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    synthesizer: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    coherence_refiner: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    plain_language_synthesizer: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    section_rewriter: pair(V2M.QWEN_72B, V2M.LLAMA_3_3),
    skeptic: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
    internal_challenger: pair(V2M.DARK_CHAMPION, V2M.DOLPHIN_QWEN),
  }),

  NOVEL_APPLICATION_DISCOVERY: v2Mode({
    planner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    reasoner: pair(V2M.HERMES_3, V2M.DEEPSEEK_R1),
    change_planner: pair(V2M.HERMES_3, V2M.DEEPSEEK_R1),
    outline_architect: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_drafter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    coherence_refiner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    plain_language_synthesizer: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    section_rewriter: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    skeptic: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
    internal_challenger: pair(V2M.DOLPHIN_QWEN, V2M.DARK_CHAMPION),
  }),

  ANOMALY_CORRELATION: v2Mode({
    planner: pair(V2M.LLAMA_3_3, V2M.HERMES_3),
    reasoner: pair(V2M.DEEPSEEK_R1, V2M.HERMES_3),
    change_planner: pair(V2M.DEEPSEEK_R1, V2M.HERMES_3),
    outline_architect: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
    section_drafter: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
    synthesizer: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
    coherence_refiner: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
    plain_language_synthesizer: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
    section_rewriter: pair(V2M.HERMES_3, V2M.LLAMA_3_3),
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
