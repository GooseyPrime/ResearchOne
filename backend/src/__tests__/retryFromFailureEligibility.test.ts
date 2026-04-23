import { describe, expect, it } from 'vitest';
import { isFailureMetaRetryable } from '../utils/researchRetryEligibility';

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
