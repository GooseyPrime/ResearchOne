import { describe, expect, it } from 'vitest';

function isRetryable(failureMeta: Record<string, unknown> | null | undefined): boolean {
  const fm = failureMeta ?? {};
  return fm.retryable === true || fm.resumeAvailable === true;
}

describe('retry-from-failure eligibility compatibility', () => {
  it('accepts explicit retryable=true', () => {
    expect(isRetryable({ retryable: true })).toBe(true);
  });

  it('accepts legacy resumeAvailable=true', () => {
    expect(isRetryable({ resumeAvailable: true })).toBe(true);
  });

  it('rejects when neither flag is true', () => {
    expect(isRetryable({})).toBe(false);
    expect(isRetryable({ retryable: false, resumeAvailable: false })).toBe(false);
  });
});
