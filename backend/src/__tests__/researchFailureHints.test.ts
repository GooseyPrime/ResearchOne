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

/**
 * Coverage added on 2026-04-28-PM (PR #41) for the OpenRouter
 * "No allowed providers are available" outage and the post-PR41
 * review feedback. The hints below are the user-facing copy the
 * FailureCard surfaces when the orchestrator's failure-meta carries
 * `upstream='openrouter'` plus either the literal "No allowed
 * providers" providerMessage or a generic 404. Without these, the
 * FailureCard falls back to the generic "non-recoverable" message
 * which is what the user actually saw during the outage.
 */
describe('buildModelFailureOrchestratorHints — OpenRouter 404 (PR #41)', () => {
  it('emits the no-allowed-providers hint when OpenRouter returns 404 with that message', () => {
    const hints = buildModelFailureOrchestratorHints({
      upstream: 'openrouter',
      classification: 'provider_unavailable',
      status: 404,
      providerMessage: 'No allowed providers are available for the selected model',
      role: 'planner',
      model: 'nousresearch/hermes-4-70b',
    });
    expect(hints.length).toBeGreaterThan(0);
    const joined = hints.join(' | ').toLowerCase();
    expect(joined).toMatch(/no allowed providers|account-side|provider/i);
    // The hint must surface concrete remediation: server-side env or
    // per-run model override.
    expect(joined).toMatch(
      /openrouter_data_collection|per-run override|switch the failing role|allow training on prompts/i
    );
  });

  it('emits the generic OpenRouter 404 hint when the message is "Model not found"', () => {
    const hints = buildModelFailureOrchestratorHints({
      upstream: 'openrouter',
      classification: 'bad_request', // generic 404 (typo'd slug) stays bad_request
      status: 404,
      providerMessage: 'Model not found',
      role: 'planner',
      model: 'nousresearch/typo-slug',
    });
    expect(hints.length).toBeGreaterThan(0);
    const joined = hints.join(' | ').toLowerCase();
    expect(joined).toMatch(/stale|verify the slug|openrouter\/api\/v1\/models/i);
    // The generic 404 hint should NOT mention the data-collection
    // remediation, which is specific to the no-allowed-providers case.
    expect(joined).not.toMatch(/openrouter_data_collection/);
  });

  it('mergeOrchestratorHintsIntoFailureMeta is idempotent on the OpenRouter 404 path', () => {
    const meta: Record<string, unknown> = {
      upstream: 'openrouter',
      classification: 'provider_unavailable',
      status: 404,
      providerMessage: 'No allowed providers are available for the selected model',
      role: 'planner',
      orchestratorHints: ['existing user hint'],
    };
    mergeOrchestratorHintsIntoFailureMeta(meta);
    const after1 = (meta.orchestratorHints as string[]).slice();
    expect(after1[0]).toBe('existing user hint');
    expect(after1.length).toBeGreaterThan(1);
    // Calling merge a second time MUST NOT duplicate anything.
    mergeOrchestratorHintsIntoFailureMeta(meta);
    const after2 = meta.orchestratorHints as string[];
    expect(after2.length).toBe(after1.length);
    for (let i = 0; i < after1.length; i++) {
      expect(after2[i]).toBe(after1[i]);
    }
  });
});
