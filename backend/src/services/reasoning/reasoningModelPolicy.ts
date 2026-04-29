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
 * We disambiguate in this order:
 *
 *   1. If the id contains a `:` variant suffix (e.g. `:free`, `:beta`,
 *      `:nitro`), it is OpenRouter (HF repo ids never use `:`).
 *   2. If the id is in `OPENROUTER_SLUG_OVERRIDES`, it is OpenRouter even
 *      though its namespace prefix is HF-shared. This explicit allowlist
 *      is the only correct disambiguator for namespaces shared between
 *      HF and OpenRouter where both sides use lowercase canonical orgs
 *      (e.g. `meta-llama/`, `dphn/`).
 *   3. Otherwise, the id is HF iff it starts with one of the allowlisted
 *      HF-style namespaces. For namespaces where HF uses MixedCase and
 *      OpenRouter uses all-lowercase (`NousResearch/` vs `nousresearch/`,
 *      `Qwen/` vs `qwen/`, `DavidAU/` vs `davidau/`), only the MixedCase
 *      form belongs in this list. Lowercase OpenRouter slugs that share
 *      that namespace prefix in lowercase do NOT belong here.
 *
 * Adding a new HF-routed namespace? Add the prefix below in its HF-canonical
 * casing AND make sure no OpenRouter-canonical lowercase form of the same
 * prefix appears here — those should remain implicitly OpenRouter.
 *
 * ## Why this matters (PR #41 review fix)
 *
 * A previous revision of this file added the lowercase form `'qwen/'` to
 * `HF_NAMESPACE_PREFIXES`. That misrouted the V2 reasoner-class default
 * `qwen/qwen3-235b-a22b-thinking-2507` (an OpenRouter slug, fully lowercase)
 * through HF Inference — where it is not hosted — silently breaking V2 on
 * the GENERAL_EPISTEMIC_RESEARCH / NOVEL_APPLICATION_DISCOVERY objectives.
 * The lowercase `qwen/` form is OpenRouter-only; HF uses `Qwen/`.
 *
 * The override list also handles V1 `meta-llama/llama-3.3-70b-instruct`
 * (an OpenRouter slug) — its HF counterpart is `meta-llama/Llama-3.3-70B-Instruct`,
 * sharing the same lowercase namespace. Without the override, the prefix
 * rule alone cannot disambiguate them.
 */
const HF_NAMESPACE_PREFIXES = [
  // HF orgs whose canonical casing is MixedCase. The lowercase OpenRouter
  // forms (`nousresearch/`, `davidau/`, `qwen/`) are NEVER HF repo ids.
  'NousResearch/',
  'DavidAU/',
  'Qwen/',
  // HF orgs whose canonical casing is lowercase. For these, the same
  // prefix may appear on OpenRouter too; explicit OR slugs go in
  // OPENROUTER_SLUG_OVERRIDES below.
  'huihui-ai/',
  'deepseek-ai/',
  'meta-llama/',
  'dphn/',
] as const;

/**
 * Explicit OpenRouter slug allowlist for ids whose namespace prefix
 * also appears in `HF_NAMESPACE_PREFIXES`. Anything in this set is
 * unconditionally OpenRouter, and `isHfRepoModel` short-circuits to
 * `false` for it. Keep this list aligned with `BASE_ALLOWLIST` and
 * V2 ensemble presets — any new OpenRouter slug whose namespace prefix
 * is in HF_NAMESPACE_PREFIXES MUST be added here.
 */
const OPENROUTER_SLUG_OVERRIDES: ReadonlySet<string> = new Set([
  // PR #41 V2 reasoner-class default — `qwen/` namespace prefix shared
  // with HF `Qwen/` (different case) but Node string startsWith is case
  // sensitive so this is technically redundant; kept here as an explicit
  // safety net so adding lowercase `qwen/` back to HF_NAMESPACE_PREFIXES
  // by mistake cannot regress this slug again.
  'qwen/qwen3-235b-a22b-thinking-2507',
  // V1 OpenRouter slug — `meta-llama/llama-3.3-70b-instruct` shares the
  // `meta-llama/` namespace with HF `meta-llama/Llama-3.3-70B-Instruct`.
  'meta-llama/llama-3.3-70b-instruct',
]);

export function isHfRepoModel(model: string): boolean {
  const m = model.trim();
  if (!m.includes('/')) return false;
  // OpenRouter variant suffixes are unambiguous — HF repo ids never have ':'.
  if (m.includes(':')) return false;
  // Explicit OR-slug overrides for namespaces shared with HF.
  if (OPENROUTER_SLUG_OVERRIDES.has(m)) return false;
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
 *   - V2 presets are governed by the **inference-time behavioral test**
 *     in `docs/V2_MODEL_SELECTION_CRITERIA.md`. The model must, under
 *     our `REASONING_FIRST_PREAMBLE` system prompt, NOT refuse,
 *     sanitize, debunk-by-recall, or smooth over contradictions on
 *     research-style queries about anomalous / suppressed claims.
 *
 *     **The rule is behavioral, not a training-history label.**
 *     RLHF / abliteration / "uncensored fine-tune" are engineering
 *     proxies for the behavior, not the rule itself. As of 2026 three
 *     categories satisfy the behavioral test:
 *
 *       (a) Open-weights "Thinking" / CoT-trace reasoners with light or
 *           research-friendly RLHF — the primary V2 critical-path tier.
 *           `Qwen3-235B-A22B-Thinking-2507` (256k context, primary
 *           reasoning + synthesis engine), `moonshotai/kimi-k2-thinking`
 *           (long-horizon agentic planner), `deepseek/deepseek-r1-0528`
 *           (heavy-lifter fallback). Their CoT traces allow the operator
 *           system prompt to logically override any light RLHF refusal
 *           direction. Multi-provider on OpenRouter (≥ 3 upstreams each).
 *       (b) Abliterated weights (refusal vector orthogonalized out;
 *           `huihui-ai/*-abliterated`, `DavidAU/*-abliterated*`) —
 *           admitted; mathematically refusal-incapable; typically
 *           single-provider so used as user-opt-in / emergency fallback.
 *       (c) Uncensored fine-tunes (`Dolphin*`, `Hermes-3` / `Hermes-4`,
 *           `Sao10K/Euryale*`) — required for adversarial roles (skeptic /
 *           internal_challenger) where the baseline must be uncensored
 *           *without* needing the preamble's nudge.
 *
 * Adding a new model? Read `ResearchOne PolicyOne` (repo root) and
 * `docs/V2_MODEL_SELECTION_CRITERIA.md` first. Closed-API moderation
 * pipelines and refusal-aligned RLHF instruct bases (without abliteration)
 * MUST NOT be added as V2 default primaries — they fail the behavioral
 * test in practice. They may live here for V1 use and / or explicit V2
 * user-opt-in routing.
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

  // ── V2 / OpenRouter critical-path primaries (multi-provider) ─────────────
  // Verified ≥ 2 live OpenRouter upstreams per slug, 100% recent uptime
  // (2026-04-28). Low-refusal open weights — DeepSeek V3.x / R1 line, Kimi
  // K2 line, Qwen3-235B Thinking. Used as default V2 critical-path
  // primaries and fallbacks. See `docs/V2_MODEL_SELECTION_CRITERIA.md`.
  'deepseek/deepseek-chat-v3.1',
  'deepseek/deepseek-r1-0528',
  'deepseek/deepseek-v3.2',
  'moonshotai/kimi-k2-thinking',
  'qwen/qwen3-235b-a22b-thinking-2507',

  // ── V2 / OpenRouter adversarial-role primaries (uncensored fine-tune) ────
  // Single-provider (Venice) and dual-provider (NextBit + DeepInfra)
  // respectively. Adversarial roles tolerate single-provider risk because
  // skeptic failures are recoverable mid-pipeline.
  'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
  'sao10k/l3-euryale-70b',
  'sao10k/l3.1-euryale-70b',
  'sao10k/l3.3-euryale-70b',

  // ── V2 / OpenRouter user-opt-in only (uncensored, single-provider) ──────
  // Allowlisted for per-run override but not in any default preset because
  // they're each single-upstream on OpenRouter (Nebius / DeepInfra /
  // Venice). The 2026-04-28 outage was caused by routing every default
  // through one of these.
  'nousresearch/hermes-3-llama-3.1-405b',
  'nousresearch/hermes-3-llama-3.1-405b:free',
  'nousresearch/hermes-3-llama-3.1-70b',
  'nousresearch/hermes-4-405b',
  'nousresearch/hermes-4-70b',

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
