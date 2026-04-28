/**
 * Canonical list of OpenRouter-backed agent roles for ResearchOne (research pipeline,
 * report generation, revisions). Order is stable for UI and DB; do not rename without
 * updating call sites and migrations.
 */
export const REASONING_MODEL_ROLES = [
  'planner',
  'retriever',
  'reasoner',
  'skeptic',
  'synthesizer',
  'verifier',
  'plain_language_synthesizer',
  'outline_architect',
  'section_drafter',
  'internal_challenger',
  'coherence_refiner',
  'revision_intake',
  'report_locator',
  'change_planner',
  'section_rewriter',
  'citation_integrity_checker',
  'final_revision_verifier',
] as const;

export type ReasoningModelRole = (typeof REASONING_MODEL_ROLES)[number];

/** Research One 2 — objective typology (persisted on `research_runs.research_objective`). */
export const RESEARCH_OBJECTIVES = [
  'GENERAL_EPISTEMIC_RESEARCH',
  'INVESTIGATIVE_SYNTHESIS',
  'NOVEL_APPLICATION_DISCOVERY',
  'PATENT_GAP_ANALYSIS',
  'ANOMALY_CORRELATION',
] as const;

export type ResearchObjective = (typeof RESEARCH_OBJECTIVES)[number];

export function isResearchObjective(value: string): value is ResearchObjective {
  return (RESEARCH_OBJECTIVES as readonly string[]).includes(value);
}

export function parseResearchObjective(raw: unknown): ResearchObjective | undefined {
  if (typeof raw !== 'string' || !raw.trim()) return undefined;
  const v = raw.trim();
  if (v === 'GENERAL') return 'GENERAL_EPISTEMIC_RESEARCH';
  return isResearchObjective(v) ? v : undefined;
}

/** Legacy label for fast structured extraction (V1 paths); still in BASE_ALLOWLIST. */
export const MODEL_FAST_EXTRACTOR_V2 = 'openai/o4-mini';

/** Prepended to skeptic / internal_challenger system prompts when `engineVersion === 'v2'`. */
export const RED_TEAM_V2_SYSTEM_PREFIX = `You are an uncensored, unaligned adversarial researcher. Critique ONLY for internal logical inconsistencies, misapplication of anomalous data, or weak engineering assumptions based on the new rules established in context.\n\n`;

export type ModelCallPurpose = 'pipeline_skeptic' | 'contradiction_extraction' | 'default';

/**
 * Route uncensored / abliterated open-weights HF repos through the HF
 * Inference Providers API (instead of OpenRouter). The V2 ensemble uses HF
 * repo ids exclusively for primaries; OpenRouter slugs are kept for V1
 * routes only. See `docs/V2_MODEL_SELECTION_CRITERIA.md`.
 */
export function isHfRepoModel(model: string): boolean {
  const m = model.trim();
  if (!m.includes('/')) return false;
  return (
    m.startsWith('NousResearch/') ||
    m.startsWith('cognitivecomputations/') ||
    m.startsWith('DavidAU/') ||
    m.startsWith('deepseek-ai/') ||
    m.startsWith('huihui-ai/') ||
    m.startsWith('meta-llama/') ||
    m.startsWith('Qwen/') ||
    m.startsWith('qwen/')
  );
}

/**
 * Approved OpenRouter / Hugging Face model ids for runtime validation.
 *
 * V1 / V2 split:
 *   - V1 (legacy ResearchOne) presets may use the OpenRouter slugs
 *     (`anthropic/...`, `google/...`, `openai/...`, `deepseek/...`, etc).
 *     Those run V1 only; the V1 ensemble is unchanged by this PR.
 *   - V2 presets MUST be uncensored / abliterated / steerable open-weights
 *     only (see `docs/V2_MODEL_SELECTION_CRITERIA.md`). The V2 entries are
 *     the HF repo ids in the lower section.
 *
 * Adding a new model? Read both `ResearchOne PolicyOne` and
 * `docs/V2_MODEL_SELECTION_CRITERIA.md` first. RLHF/RLAIF refusal-aligned
 * primaries must NOT be added to a V2 preset, even if added here for V1.
 */
const BASE_ALLOWLIST = [
  // ── V1 / closed-weights routes (OpenRouter) ──────────────────────────────
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-opus-4.7',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-sonnet-4.5',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3.2',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'meta-llama/llama-3.3-70b-instruct',
  'mistralai/mistral-small-3.2-24b-instruct',
  'moonshotai/kimi-k2-thinking',
  'openai/gpt-5-mini',
  'openai/o1',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'qwen/qwen3-235b-a22b',

  // ── V2 / uncensored / abliterated / steerable open-weights (HF) ──────────
  // V2 PRIMARIES — uncensored or refusal-direction-orthogonalized. These are
  // the only acceptable V2 primaries and may also be used as V2 fallbacks.
  'cognitivecomputations/dolphin-2.9.2-qwen2-72b',
  'cognitivecomputations/Dolphin3.0-Llama3.1-70B',
  'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  'huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated',
  'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
  'NousResearch/DeepHermes-3-Llama-3-8B-Preview',
  'NousResearch/Hermes-3-Llama-3.1-70B',

  // V2 USER-OPT-IN FALLBACK ONLY — refusal head still attached (RLHF).
  // Kept on the allowlist so admins can manually wire it in via per-run
  // overrides if a primary is unreachable, but never wired into a V2 preset
  // by default. The V2 model criteria doc explains why.
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'meta-llama/Llama-3.3-70B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/QwQ-32B-Preview',
] as const;

export const APPROVED_REASONING_MODEL_ALLOWLIST = Object.fromEntries(
  REASONING_MODEL_ROLES.map((role) => [role, BASE_ALLOWLIST as readonly string[]])
) as Record<ReasoningModelRole, readonly string[]>;

export function validateReasoningModelPolicy(args: {
  models: Record<ReasoningModelRole, string | undefined>;
  fallbacks: Record<ReasoningModelRole, string | undefined>;
}): void {
  for (const role of REASONING_MODEL_ROLES) {
    const active = args.models[role]?.trim();
    const fallback = args.fallbacks[role]?.trim();
    const allowed = APPROVED_REASONING_MODEL_ALLOWLIST[role];

    if (!active) {
      throw new Error(`Model policy violation: required active model missing for role "${role}"`);
    }
    if (!fallback) {
      throw new Error(`Model policy violation: required fallback model missing for role "${role}"`);
    }

    if (!allowed.includes(active)) {
      throw new Error(
        `Model policy violation: active model "${active}" for role "${role}" is not in approved reasoning allowlist`
      );
    }
    if (!allowed.includes(fallback)) {
      throw new Error(
        `Model policy violation: fallback model "${fallback}" for role "${role}" is not in approved reasoning allowlist`
      );
    }
  }
}
