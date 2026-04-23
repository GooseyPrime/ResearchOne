import { describe, expect, it } from 'vitest';
import { buildModelFailureOrchestratorHints, mergeOrchestratorHintsIntoFailureMeta } from '../utils/researchFailureHints';

describe('buildModelFailureOrchestratorHints', () => {
  it('adds HF empty-log hint for huggingface_inference provider_unavailable', () => {
    const hints = buildModelFailureOrchestratorHints({
      upstream: 'huggingface_inference',
      classification: 'provider_unavailable',
    });
    expect(hints.some((h) => h.includes('Hugging Face model inference logs'))).toBe(true);
  });

  it('does not add HF empty-log hint for together upstream', () => {
    const hints = buildModelFailureOrchestratorHints({
      upstream: 'together',
      classification: 'provider_unavailable',
      providerFallbackAttempted: true,
      providerFallbackBackend: 'together',
      providerFallbackResult: 'failed',
    });
    expect(hints.some((h) => h.includes('Hugging Face model inference logs'))).toBe(false);
    expect(hints.some((h) => h.includes('Together.ai'))).toBe(true);
    expect(hints.some((h) => h.includes('Provider fallback attempted'))).toBe(true);
  });

  it('adds provider fallback line when providerFallbackAttempted is true', () => {
    const hints = buildModelFailureOrchestratorHints({
      upstream: 'openrouter',
      providerFallbackAttempted: true,
      providerFallbackBackend: 'together',
      providerFallbackResult: 'failed',
    });
    expect(hints.join(' ')).toMatch(/Provider fallback attempted via together/);
  });
});

describe('mergeOrchestratorHintsIntoFailureMeta', () => {
  it('dedupes against existing orchestratorHints', () => {
    const dup =
      'The request may have failed before model execution; Hugging Face model inference logs can be empty in this case.';
    const meta: Record<string, unknown> = {
      upstream: 'huggingface_inference',
      classification: 'provider_unavailable',
      orchestratorHints: [dup],
    };
    mergeOrchestratorHintsIntoFailureMeta(meta);
    const arr = meta.orchestratorHints as string[];
    expect(arr.filter((h) => h === dup).length).toBe(1);
  });
});
