import { describe, expect, it } from 'vitest';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  validateReasoningModelPolicy,
  type ReasoningModelRole,
} from '../services/reasoning/reasoningModelPolicy';

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
