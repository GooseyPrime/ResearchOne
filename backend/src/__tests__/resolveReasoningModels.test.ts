import { describe, expect, it } from 'vitest';
import {
  MODEL_FAST_EXTRACTOR_V2,
  MODEL_LATERAL_THINKER_V2,
  MODEL_STRICT_LOGICIAN_FALLBACK_V2,
  MODEL_STRICT_LOGICIAN_PRIMARY_V2,
  MODEL_UNBIASED_CHALLENGER_FALLBACK_V2,
  MODEL_UNBIASED_CHALLENGER_PRIMARY_V2,
  resolveReasoningModels,
  isHfRepoModel,
} from '../services/reasoning/reasoningModelPolicy';

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

  it('maps planner to strict logician by default', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'planner',
    });
    expect(r).toEqual({
      primary: MODEL_STRICT_LOGICIAN_PRIMARY_V2,
      fallback: MODEL_STRICT_LOGICIAN_FALLBACK_V2,
    });
  });

  it('maps planner to lateral for patent / novel objectives', () => {
    for (const o of ['PATENT_GAP_ANALYSIS', 'NOVEL_APPLICATION_DISCOVERY'] as const) {
      const r = resolveReasoningModels({
        engineVersion: 'v2',
        researchObjective: o,
        role: 'planner',
      });
      expect(r).toEqual({
        primary: MODEL_LATERAL_THINKER_V2,
        fallback: MODEL_LATERAL_THINKER_V2,
      });
    }
  });

  it('routes pipeline skeptic to HF pair', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL',
      role: 'skeptic',
      callPurpose: 'pipeline_skeptic',
    });
    expect(r).toEqual({
      primary: MODEL_UNBIASED_CHALLENGER_PRIMARY_V2,
      fallback: MODEL_UNBIASED_CHALLENGER_FALLBACK_V2,
    });
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

  it('returns null for revision roles (legacy path)', () => {
    expect(
      resolveReasoningModels({
        engineVersion: 'v2',
        researchObjective: 'GENERAL',
        role: 'revision_intake',
      })
    ).toBeNull();
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
