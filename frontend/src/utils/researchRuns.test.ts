import { describe, expect, it } from 'vitest';
import { hasInFlightResearchRuns, isInFlightRunStatus } from './researchRuns';

describe('researchRuns', () => {
  it('isInFlightRunStatus recognizes live statuses', () => {
    expect(isInFlightRunStatus('plan_pending_confirmation')).toBe(true);
    expect(isInFlightRunStatus('running')).toBe(true);
    expect(isInFlightRunStatus('completed')).toBe(false);
  });

  it('hasInFlightResearchRuns is true when any row is in flight', () => {
    expect(
      hasInFlightResearchRuns([
        { status: 'completed' },
        { status: 'plan_pending_confirmation' },
      ])
    ).toBe(true);
    expect(hasInFlightResearchRuns([{ status: 'failed' }])).toBe(false);
    expect(hasInFlightResearchRuns(undefined)).toBe(false);
  });
});
