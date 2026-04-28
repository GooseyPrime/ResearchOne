import { describe, expect, it } from 'vitest';
import { isHfRepoModel } from '../services/reasoning/reasoningModelPolicy';
import { V2_MODE_PRESETS, resolveReasoningModels } from '../config/researchEnsemblePresets';

describe('resolveReasoningModels', () => {
  it('returns null for non-v2 engine', () => {
    expect(
      resolveReasoningModels({
        engineVersion: undefined,
        researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
        role: 'planner',
      })
    ).toBeNull();
    expect(
      resolveReasoningModels({
        engineVersion: 'v1',
        researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
        role: 'planner',
      })
    ).toBeNull();
  });

  it('maps planner from GENERAL_EPISTEMIC_RESEARCH preset with fallback when allowFallbackForRole true', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      role: 'planner',
      allowFallbackForRole: true,
    });
    expect(r).toEqual(V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH.planner);
  });

  it('omits fallback when allowFallbackForRole is false', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      role: 'planner',
      allowFallbackForRole: false,
    });
    expect(r).toEqual({
      primary: V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH.planner.primary,
    });
  });

  it('maps planner from PATENT_GAP_ANALYSIS preset', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'PATENT_GAP_ANALYSIS',
      role: 'planner',
      allowFallbackForRole: true,
    });
    expect(r).toEqual(V2_MODE_PRESETS.PATENT_GAP_ANALYSIS.planner);
  });

  it('routes pipeline skeptic from preset', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      role: 'skeptic',
      callPurpose: 'pipeline_skeptic',
      allowFallbackForRole: true,
    });
    expect(r).toEqual(V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH.skeptic);
  });

  it('routes contradiction extraction to same skeptic preset as pipeline (no corporate override)', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      role: 'skeptic',
      callPurpose: 'contradiction_extraction',
      allowFallbackForRole: true,
    });
    expect(r).toEqual(V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH.skeptic);
  });

  it('includes revision roles in V2 presets', () => {
    const r = resolveReasoningModels({
      engineVersion: 'v2',
      researchObjective: 'GENERAL_EPISTEMIC_RESEARCH',
      role: 'revision_intake',
      allowFallbackForRole: true,
    });
    expect(r).toEqual(V2_MODE_PRESETS.GENERAL_EPISTEMIC_RESEARCH.revision_intake);
  });
});

describe('isHfRepoModel', () => {
  it('detects allowlisted HF repos', () => {
    expect(isHfRepoModel('NousResearch/Hermes-3-Llama-3.1-70B')).toBe(true);
    expect(isHfRepoModel('DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B')).toBe(true);
    expect(isHfRepoModel('huihui-ai/Llama-3.3-70B-Instruct-abliterated')).toBe(true);
    expect(isHfRepoModel('dphn/dolphin-2.9.2-qwen2-72b')).toBe(true);
    expect(isHfRepoModel('meta-llama/Llama-3.3-70B-Instruct')).toBe(true);
    expect(isHfRepoModel('Qwen/Qwen2.5-72B-Instruct')).toBe(true);
  });

  it('rejects OpenRouter slugs (no `:` variant suffix)', () => {
    expect(isHfRepoModel('openai/o3')).toBe(false);
    expect(isHfRepoModel('anthropic/claude-opus-4.7')).toBe(false);
    expect(isHfRepoModel('nousresearch/hermes-4-70b')).toBe(false);
    expect(isHfRepoModel('sao10k/l3.3-euryale-70b')).toBe(false);
  });

  it('rejects any id with a `:` variant suffix as OpenRouter-only', () => {
    expect(isHfRepoModel('cognitivecomputations/dolphin-mistral-24b-venice-edition:free')).toBe(false);
    expect(isHfRepoModel('nousresearch/hermes-3-llama-3.1-405b:free')).toBe(false);
  });

  it('does not route the deprecated `cognitivecomputations/dolphin-2.9.2-qwen2-72b` slug through HF', () => {
    // Renamed upstream to dphn/dolphin-2.9.2-qwen2-72b; the old id would 404
    // on HF Inference. Forcing it through OpenRouter (where it does not
    // exist either) is a clearer failure mode than silently 404ing on HF.
    // V1 presets have been migrated to the renamed slug — see the
    // `M.dolphin` constant in `researchEnsemblePresets.ts`.
    expect(isHfRepoModel('cognitivecomputations/dolphin-2.9.2-qwen2-72b')).toBe(false);
  });

  it('V1 dolphin slot points at a slug that still routes through HF', () => {
    // Regression guard for the PR #40 Copilot review: when the
    // `cognitivecomputations/` HF prefix was dropped, the V1 ensemble
    // would silently switch providers if anyone ever changes
    // `M.dolphin` back to the legacy slug. This test pins the contract
    // that the V1 dolphin slot must be HF-routable.
    const v1Dolphin = 'dphn/dolphin-2.9.2-qwen2-72b';
    expect(isHfRepoModel(v1Dolphin)).toBe(true);
  });
});
