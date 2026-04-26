import { describe, expect, it } from 'vitest';
import {
  isFailureMetaRetryable,
  mergeFailureMetaForRetry,
} from '../utils/researchRetryEligibility';

describe('researchRetryEligibility (retry budget interaction)', () => {
  it('isFailureMetaRetryable returns false for null/empty meta', () => {
    expect(isFailureMetaRetryable(null)).toBe(false);
    expect(isFailureMetaRetryable(undefined)).toBe(false);
    expect(isFailureMetaRetryable({})).toBe(false);
  });

  it('isFailureMetaRetryable returns true when retryable=true', () => {
    expect(isFailureMetaRetryable({ retryable: true })).toBe(true);
  });

  it('mergeFailureMetaForRetry preserves role/classification', () => {
    const merged = mergeFailureMetaForRetry(
      {
        role: 'retriever',
        classification: 'provider_unavailable',
        model: 'meta-llama/Llama-3.3-70B-Instruct',
      },
      2
    );

    expect(merged.retryable).toBe(true);
    expect(merged.resumeAvailable).toBe(true);
    expect(merged.retryCount).toBe(2);
    expect(merged.role).toBe('retriever');
    expect(merged.classification).toBe('provider_unavailable');
    expect(typeof merged.lastRetryAt).toBe('string');
  });

  it('mergeFailureMetaForRetry on null produces a usable meta with retry bookkeeping', () => {
    const merged = mergeFailureMetaForRetry(null, 1);
    expect(merged.retryable).toBe(true);
    expect(merged.resumeAvailable).toBe(true);
    expect(merged.retryCount).toBe(1);
  });
});
