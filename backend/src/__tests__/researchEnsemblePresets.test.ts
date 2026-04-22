import { describe, expect, it } from 'vitest';
import {
  ENSEMBLE_PRESETS,
  mergePresetWithRuntimeOverride,
  validateEnsemblePresetsAgainstAllowlist,
  validateV2ModePresetsAgainstAllowlist,
} from '../config/researchEnsemblePresets';
import { REASONING_MODEL_ROLES, RESEARCH_OBJECTIVES } from '../services/reasoning/reasoningModelPolicy';

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
});
