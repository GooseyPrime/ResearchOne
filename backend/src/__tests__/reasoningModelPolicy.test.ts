import { describe, expect, it } from 'vitest';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  isHfRepoModel,
  validateReasoningModelPolicy,
  type ReasoningModelRole,
} from '../services/reasoning/reasoningModelPolicy';
import { V2_MODE_PRESETS } from '../config/researchEnsemblePresets';
import { RESEARCH_OBJECTIVES, REASONING_MODEL_ROLES } from '../services/reasoning/reasoningModelPolicy';

const roles = Object.keys(APPROVED_REASONING_MODEL_ALLOWLIST) as ReasoningModelRole[];

function makeValidConfig() {
  const models = {} as Record<ReasoningModelRole, string>;
  const fallbacks = {} as Record<ReasoningModelRole, string>;
  for (const role of roles) {
    models[role] = APPROVED_REASONING_MODEL_ALLOWLIST[role][0];
    fallbacks[role] = APPROVED_REASONING_MODEL_ALLOWLIST[role][1] ?? APPROVED_REASONING_MODEL_ALLOWLIST[role][0];
  }
  return { models, fallbacks };
}

describe('reasoning model policy', () => {
  it('fails when a non-approved model is configured', () => {
    const cfg = makeValidConfig();
    cfg.models.synthesizer = 'qwen/qwen-2.5-72b-instruct';
    expect(() => validateReasoningModelPolicy(cfg)).toThrow(/not in approved reasoning allowlist/);
  });

  it('fails when a required fallback is missing', () => {
    const cfg = makeValidConfig();
    cfg.fallbacks.verifier = '';
    expect(() => validateReasoningModelPolicy(cfg)).toThrow(/required fallback model missing/);
  });

  it('passes when all required active and fallback models are approved', () => {
    const cfg = makeValidConfig();
    expect(() => validateReasoningModelPolicy(cfg)).not.toThrow();
  });
});

/**
 * Regression guard for the PR #41 review finding (Copilot / 2026-04-28-PM):
 * lowercase OpenRouter slugs whose namespace prefix overlaps with a HF org
 * (`qwen/`, `meta-llama/`) MUST route through OpenRouter, never through HF
 * Inference. The previous revision misclassified `qwen/qwen3-235b-a22b-thinking-2507`
 * as HF, silently breaking the V2 reasoner-class default on multiple
 * research objectives.
 */
describe('isHfRepoModel — OpenRouter vs HF disambiguation (PR #41 regression)', () => {
  const orSlugs = [
    'qwen/qwen3-235b-a22b-thinking-2507', // V2 reasoner class — was misrouted
    'deepseek/deepseek-v3.2',
    'deepseek/deepseek-chat-v3.1',
    'deepseek/deepseek-r1-0528',
    'moonshotai/kimi-k2-thinking',
    'cognitivecomputations/dolphin-mistral-24b-venice-edition:free',
    'sao10k/l3.3-euryale-70b',
    'sao10k/l3-euryale-70b',
    'sao10k/l3.1-euryale-70b',
    'meta-llama/llama-3.3-70b-instruct', // V1 OR slug — namespace shared with HF
    'nousresearch/hermes-3-llama-3.1-70b',
    'nousresearch/hermes-4-70b',
    'anthropic/claude-3.7-sonnet',
    'openai/gpt-5-mini',
  ];
  const hfSlugs = [
    'NousResearch/Hermes-3-Llama-3.1-70B',
    'Qwen/Qwen2.5-72B-Instruct',
    'Qwen/QwQ-32B-Preview',
    'meta-llama/Llama-3.3-70B-Instruct',
    'huihui-ai/Llama-3.3-70B-Instruct-abliterated',
    'huihui-ai/DeepSeek-R1-Distill-Llama-70B-abliterated',
    'huihui-ai/Qwen2.5-72B-Instruct-abliterated',
    'deepseek-ai/DeepSeek-R1-Distill-Llama-70B',
    'dphn/dolphin-2.9.2-qwen2-72b',
    'DavidAU/Llama-3.2-8X3B-MOE-Dark-Champion-Instruct-uncensored-abliterated-18.4B',
  ];

  it.each(orSlugs)('routes %s to OpenRouter (isHfRepoModel === false)', (slug) => {
    expect(isHfRepoModel(slug)).toBe(false);
  });
  it.each(hfSlugs)('routes %s to HF Inference (isHfRepoModel === true)', (slug) => {
    expect(isHfRepoModel(slug)).toBe(true);
  });

  it('every V2 default primary that looks like an OpenRouter slug actually routes to OpenRouter', () => {
    // This is the contract that PR #41 exists to enforce: every V2
    // default primary marked as "OpenRouter critical-path multi-provider"
    // in researchEnsemblePresets.ts must NOT slip through `isHfRepoModel`
    // and end up calling HF Inference (where these slugs do not exist).
    const offenders: Array<{ objective: string; role: string; slug: string }> = [];
    for (const objective of RESEARCH_OBJECTIVES) {
      const preset = V2_MODE_PRESETS[objective];
      for (const role of REASONING_MODEL_ROLES) {
        const slug = preset[role]?.primary;
        if (!slug) continue;
        // OpenRouter canonical form: all-lowercase namespace, may include `:` variant.
        // We only check lowercase slugs here — uppercase HF-form slugs are
        // separately allowed for V2 user-opt-in fallbacks.
        const looksLikeOR = slug === slug.toLowerCase();
        if (looksLikeOR && isHfRepoModel(slug)) {
          offenders.push({ objective, role, slug });
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
