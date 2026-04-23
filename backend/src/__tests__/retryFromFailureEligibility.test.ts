import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isFailureMetaRetryable, mergeFailureMetaForRetry } from '../utils/researchRetryEligibility';

describe('retry-from-failure eligibility compatibility', () => {
  it('accepts explicit retryable=true', () => {
    expect(isFailureMetaRetryable({ retryable: true })).toBe(true);
  });

  it('accepts legacy resumeAvailable=true', () => {
    expect(isFailureMetaRetryable({ resumeAvailable: true })).toBe(true);
  });

  it('rejects when neither flag is true', () => {
    expect(isFailureMetaRetryable({})).toBe(false);
    expect(isFailureMetaRetryable({ retryable: false, resumeAvailable: false })).toBe(false);
  });
});

describe('mergeFailureMetaForRetry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('keeps classification and role and sets retry flags for next resume', () => {
    const merged = mergeFailureMetaForRetry(
      {
        retryable: true,
        classification: 'provider_unavailable',
        role: 'retriever',
        model: 'Qwen/Qwen2.5-32B-Instruct',
        retryCount: 0,
      },
      1
    );
    expect(merged.classification).toBe('provider_unavailable');
    expect(merged.role).toBe('retriever');
    expect(merged.model).toBe('Qwen/Qwen2.5-32B-Instruct');
    expect(merged.retryCount).toBe(1);
    expect(merged.retryable).toBe(true);
    expect(merged.resumeAvailable).toBe(true);
    expect(merged.lastRetryAt).toBe('2026-01-15T12:00:00.000Z');
    expect(isFailureMetaRetryable(merged)).toBe(true);
  });
});
