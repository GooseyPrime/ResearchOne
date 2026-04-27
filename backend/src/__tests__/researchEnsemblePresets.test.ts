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
 * model into the V2 ensemble.
 */
const V2_FORBIDDEN_DEFAULT_MODELS = new Set([
  'meta-llama/Llama-3.3-70B-Instruct',
  'meta-llama/llama-3.3-70b-instruct',
  'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
  'Qwen/Qwen2.5-72B-Instruct',
  'Qwen/Qwen2.5-32B-Instruct',
  'Qwen/Qwen2.5-14B-Instruct',
  'Qwen/QwQ-32B-Preview',
  // Any closed-API slug — V2 is open-weights only.
  'anthropic/claude-3.5-haiku',
  'anthropic/claude-3.7-sonnet',
  'anthropic/claude-sonnet-4',
  'anthropic/claude-sonnet-4.5',
  'deepseek/deepseek-chat',
  'deepseek/deepseek-r1',
  'deepseek/deepseek-v3.2',
  'google/gemini-2.5-flash',
  'google/gemini-2.5-pro',
  'mistralai/mistral-small-3.2-24b-instruct',
  'moonshotai/kimi-k2-thinking',
  'openai/gpt-5-mini',
  'openai/o1',
  'openai/o3',
  'openai/o3-mini',
  'openai/o4-mini',
  'qwen/qwen3-235b-a22b',
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
