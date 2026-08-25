import { describe, expect, it } from 'vitest';
import {
  hasInFlightResearchRuns,
  isInFlightRunStatus,
  researchRunsPollIntervalMs,
} from './researchRuns';

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

describe('researchRunsPollIntervalMs', () => {
  it('stops polling when nothing is in flight', () => {
    // React Query takes the SHORTEST interval across observers of a key, so an
    // observer that polls unconditionally overrides every other observer's idle
    // backoff. `ActiveRunBadge` did exactly that and kept every mounted Layout
    // requesting the run list every eight seconds forever (Codex, #227).
    expect(researchRunsPollIntervalMs([{ status: 'completed' }, { status: 'failed' }], 8_000)).toBe(false);
    expect(researchRunsPollIntervalMs([], 8_000)).toBe(false);
    expect(researchRunsPollIntervalMs(undefined, 8_000)).toBe(false);
  });

  it('polls while any run is in flight', () => {
    for (const status of ['running', 'queued', 'plan_pending_confirmation']) {
      const out = researchRunsPollIntervalMs([{ status: 'completed' }, { status }], 8_000);
      expect(typeof out).toBe('number');
      expect(out).toBeGreaterThan(0);
    }
  });
});
