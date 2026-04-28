import { describe, expect, it } from 'vitest';
import {
  ENSEMBLE_PRESETS,
  V2_MODE_PRESETS,
  mergePresetWithRuntimeOverride,
  validateEnsemblePresetsAgainstAllowlist,
  validateV2ModePresetsAgainstAllowlist,
} from '../config/researchEnsemblePresets';
import { REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../services/reasoning/reasoningModelPolicy';

/**
 * Models that are allowlisted but FORBIDDEN as a V2 default primary (or
 * default fallback) per `docs/V2_MODEL_SELECTION_CRITERIA.md`. They
 * remain on the deployment allowlist so admins can wire them in via
 * per-run overrides as a user-opt-in fallback, but they must not appear
 * in any V2_MODE_PRESETS default. This list is the policy gate that
 * stops a future PR from accidentally re-introducing a refusal-aligned
 * or single-provider model into the V2 ensemble.
 *
 * Updated 2026-04-28-PM (PR #41 post-mortem): the binding criteria now
 * admit low-refusal multi-provider open-weights (DeepSeek V3.x / R1 /
 * Qwen Thinking / Kimi K2 Thinking) as V2 critical-path primaries
 * because the previous "uncensored only" criterion forced us onto
 * single-provider Hermes / Dolphin slugs that were not reliably
 * deployable. See V2_MODEL_SELECTION_CRITERIA.md.
 */
const V2_FORBIDDEN_DEFAULT_MODELS = new Set([
  // RLHF refusal-aligned base instruct slugs (without abliteration). These
  // refuse anomalous research queries under our reasoning-first preamble.
  'meta-llama/Llama-3.3-70B-Instruct',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/QwQ-32B-Preview',
  // Closed-API moderation pipelines — V2 is open-weights only.
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-sonnet-4.5',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'mistralai/mistral-small-3.2-24b-instruct',
  'openai/gpt-5-mini',
  'openai/o1',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  // Older / less-reliable DeepSeek slugs we deliberately don't default to.
  // The current V2 default ladder uses deepseek/deepseek-v3.2,
  // deepseek/deepseek-chat-v3.1, deepseek/deepseek-r1-0528 (multi-provider).
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1', // 2-provider; we use r1-0528 (5-provider) instead
  // Qwen3-235B-A22B (non-Thinking variant) is single-provider on
  // OpenRouter (Alibaba only). The Thinking variant is multi-provider.
  'qwen/qwen3-235b-a22b',
  // Single-provider HF slugs (subject to single-point-of-failure outages).
  // Allowlisted for user-opt-in routing only; never as a V2 default. The
  // 2026-04-28 V2 outage was caused by routing every default through these
  // featherless-ai-only slugs. After the post-mortem they are explicitly
  // demoted to user-opt-in and forbidden as defaults.
  'NousResearch/Hermes-3-Llama-3.1-70B',
  'NousResearch/DeepHermes-3-Llama-3-8B-Preview',
  'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
  'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
  'huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated',
  'dphn/dolphin-2.9.2-qwen2-72b',
  'cognitivecomputations/dolphin-2.9.2-qwen2-72b',
  'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  // Single-upstream OpenRouter slugs (Nebius / DeepInfra only). The
  // 2026-04-28-PM second outage was caused by routing every default
  // through nousresearch/hermes-4-70b which is Nebius-only and got 404
  // "No allowed providers are available" on a typical OpenRouter
  // account. After that post-mortem (PR #41) these too are demoted to
  // user-opt-in only and forbidden as critical-path defaults.
  'nousresearch/hermes-4-70b',
  'nousresearch/hermes-4-405b',
  'nousresearch/hermes-3-llama-3.1-70b',
  'nousresearch/hermes-3-llama-3.1-405b',
  'nousresearch/hermes-3-llama-3.1-405b:free',
]);

describe('researchEnsemblePresets', () => {
  it('validateEnsemblePresetsAgainstAllowlist passes', () => {
    expect(() => validateEnsemblePresetsAgainstAllowlist()).not.toThrow();
  });

  it('validateV2ModePresetsAgainstAllowlist passes', () => {
    expect(() => validateV2ModePresetsAgainstAllowlist()).not.toThrow();
  });

  it('mergePresetWithRuntimeOverride prefers non-empty runtime fields', () => {
    const base = { primary: 'a/x', fallback: 'b/y' };
    expect(mergePresetWithRuntimeOverride(base, {}, true)).toEqual(base);
    expect(mergePresetWithRuntimeOverride(base, { primary: 'openai/o3' }, true)).toEqual({
      primary: 'openai/o3',
      fallback: 'b/y',
    });
    expect(
      mergePresetWithRuntimeOverride(base, { primary: 'openai/o3', fallback: 'deepseek/deepseek-r1' }, true)
    ).toEqual({ primary: 'openai/o3', fallback: 'deepseek/deepseek-r1' });
  });

  it('mergePresetWithRuntimeOverride drops fallback when allowFallbackForRole is false', () => {
    const base = { primary: 'a/x', fallback: 'b/y' };
    expect(mergePresetWithRuntimeOverride(base, { fallback: 'deepseek/deepseek-r1' }, false)).toEqual({
      primary: 'a/x',
      fallback: undefined,
    });
  });

  it('has every objective and every role', () => {
    for (const obj of RESEARCH_OBJECTIVES) {
      const preset = ENSEMBLE_PRESETS[obj];
      expect(preset).toBeDefined();
      for (const role of REASONING_MODEL_ROLES) {
        expect(preset[role]?.primary).toBeTruthy();
        expect(preset[role]?.fallback).toBeTruthy();
      }
    }
  });

  it('V2_MODE_PRESETS never wires a refusal-aligned slug as a default primary or fallback', () => {
    const violations: string[] = [];
    for (const obj of RESEARCH_OBJECTIVES) {
      const preset = V2_MODE_PRESETS[obj];
      for (const role of REASONING_MODEL_ROLES) {
        const { primary, fallback } = preset[role];
        if (V2_FORBIDDEN_DEFAULT_MODELS.has(primary)) {
          violations.push(`${obj}.${role}.primary = "${primary}" (forbidden as V2 default)`);
        }
        if (fallback && V2_FORBIDDEN_DEFAULT_MODELS.has(fallback)) {
          violations.push(`${obj}.${role}.fallback = "${fallback}" (forbidden as V2 default)`);
        }
      }
    }
    expect(violations).toEqual([]);
  });
});
