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
 * Decide whether a model id should route through the HF Inference Providers
 * API (true) or OpenRouter (false).
 *
 * OpenRouter and HF Inference both use `vendor/model` ids and the namespaces
 * sometimes overlap (e.g. `NousResearch/Hermes-3-Llama-3.1-70B` is a HF
 * repo, while `nousresearch/hermes-3-llama-3.1-70b` is its OpenRouter slug).
 * We disambiguate by:
 *   - If the id contains a `:` variant suffix (e.g. `:free`, `:beta`,
 *     `:nitro`), it is OpenRouter (HF repo ids never use `:`).
 *   - Otherwise, the id is HF iff it starts with one of the allowlisted
 *     HF-style namespaces (case-sensitive — HF preserves casing while
 *     OpenRouter slugs are all lowercase).
 *
 * Adding a new HF-routed namespace? Add the prefix below AND make sure
 * its OpenRouter equivalent is lowercase so the case check disambiguates
 * correctly.
 */
const HF_NAMESPACE_PREFIXES = [
  'NousResearch/',
  'DavidAU/',
  'huihui-ai/',
  'deepseek-ai/',
  'meta-llama/',
  'Qwen/',
  'qwen/',
  'dphn/',
] as const;

export function isHfRepoModel(model: string): boolean {
  const m = model.trim();
  if (!m.includes('/')) return false;
  // OpenRouter variant suffixes are unambiguous — HF repo ids never have ':'.
  if (m.includes(':')) return false;
  // `cognitivecomputations/` is ambiguous: the V2 default
  // `cognitivecomputations/dolphin-mistral-24b-venice-edition:free` is an
  // OpenRouter slug (caught above by ':'), while
  // `cognitivecomputations/dolphin-2.9.2-qwen2-72b` is HF-only — but HF has
  // since renamed that to `dphn/dolphin-2.9.2-qwen2-72b`, so we no longer
  // route any cognitivecomputations/* through HF.
  return HF_NAMESPACE_PREFIXES.some((p) => m.startsWith(p));
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

  // ── V2 / uncensored / steerable open-weights (OpenRouter, multi-provider) ─
  // V2 default primaries route through OpenRouter, which fans out to multiple
  // upstream providers per model. This eliminates the single-HF-provider
  // failure mode the post-merge V2 run hit on 2026-04-28
  // (`provider_unavailable` on featherless-ai-only Hermes-3). All entries
  // here are uncensored or steerable / non-refusal-aligned per
  // `docs/V2_MODEL_SELECTION_CRITERIA.md`.
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'nousresearch/hermes-3-llama-3.1-405b',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'nousresearch/hermes-3-llama-3.1-70b',
  'nousresearch/hermes-4-405b',
  'nousresearch/hermes-4-70b',
  'sao10k/l3-euryale-70b',
  'sao10k/l3.1-euryale-70b',
  'sao10k/l3.3-euryale-70b',

  // ── V2 / uncensored / abliterated open-weights (HF Inference) ────────────
  // Allowlisted for user-opt-in via per-run model overrides. Not used as a
  // V2 default because most are single-provider (featherless-ai) on HF
  // Inference and so are subject to single-point-of-failure outages.
  'huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated',
  'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
  'NousResearch/DeepHermes-3-Llama-3-8B-Preview',
  'NousResearch/Hermes-3-Llama-3.1-70B',
  'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  'dphn/dolphin-2.9.2-qwen2-72b',
  // Legacy V1 carry-over: V1 ensembles still reference this id as an
  // adversarial fallback. Allowlisted so V1 startup validation passes; V2
  // never wires this slug. The model is now hosted at
  // `dphn/dolphin-2.9.2-qwen2-72b` upstream — the V1 entry will be migrated
  // separately.
  'cognitivecomputations/dolphin-2.9.2-qwen2-72b',

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
