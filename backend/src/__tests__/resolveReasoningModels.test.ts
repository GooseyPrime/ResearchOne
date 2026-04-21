import { describe, expect, it } from 'vitest';
import {
  MODEL_FAST_EXTRACTOR_V2,
  isHfRepoModel,
} from '../services/reasoning/reasoningModelPolicy';
import { ENSEMBLE_PRESETS, resolveReasoningModels } from '../config/researchEnsemblePresets';

describe('resolveReasoningModels', () => {
  it('returns null for non-v2 engine', () => {
    expect(
      resolveReasoningModels({
        engineVersion: undefined,
        researchObjective: 'GENERAL',
        role: 'planner',
      })
    ).toBeNull();
    expect(
      resolveReasoningModels({
        engineVersion: 'v1',
        researchObjective: 'GENERAL',
        role: 'planner',
      })
    ).toBeNull();
  });

  it('maps planner from GENERAL preset', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'planner',
    });
    expect(r).toEqual(ENSEMBLE_PRESETS.GENERAL.planner);
  });

  it('maps planner from PATENT_GAP_ANALYSIS preset', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'PATENT_GAP_ANALYSIS',
      role: 'planner',
    });
    expect(r).toEqual(ENSEMBLE_PRESETS.PATENT_GAP_ANALYSIS.planner);
  });

  it('routes pipeline skeptic from preset', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'skeptic',
      callPurpose: 'pipeline_skeptic',
    });
    expect(r).toEqual(ENSEMBLE_PRESETS.GENERAL.skeptic);
  });

  it('routes contradiction extraction to fast extractor', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'skeptic',
      callPurpose: 'contradiction_extraction',
    });
    expect(r).toEqual({
      primary: MODEL_FAST_EXTRACTOR_V2,
      fallback: MODEL_FAST_EXTRACTOR_V2,
    });
  });

  it('includes revision roles in presets', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'revision_intake',
    });
    expect(r).toEqual(ENSEMBLE_PRESETS.GENERAL.revision_intake);
  });
});

describe('isHfRepoModel', () => {
  it('detects allowlisted HF repos', () => {
    expect(isHfRepoModel('NousResearch/Hermes-3-Llama-3.1-70B')).toBe(true);
    expect(isHfRepoModel('cognitivecomputations/dolphin-2.9.2-qwen2-72b')).toBe(true);
  });

  it('rejects OpenRouter slugs', () => {
    expect(isHfRepoModel('openai/o3')).toBe(false);
    expect(isHfRepoModel('anthropic/claude-opus-4.7')).toBe(false);
  });
});
