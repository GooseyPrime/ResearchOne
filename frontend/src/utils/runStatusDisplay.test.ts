import { describe, it, expect } from 'vitest';

import {
  isCleanRunOutcome,
  resolveRunDisplayState,
  RUN_TONE_CLASSES,
} from './runStatusDisplay';

/**
 * These rules exist in the backend too, deliberately: the backend decides what
 * a run's terminal state IS, the frontend decides how it LOOKS. They must agree
 * on which outcomes are trustworthy, or a failed run gets a green badge again.
 *
 * Keep in sync with `backend/src/__tests__/runStatusConsistency.test.ts`.
 */

describe('resolveRunDisplayState', () => {
  it('never presents a gated failure as a success', () => {
    for (const gate of ['contract_failed', 'verification_failed', 'completed_degraded'] as const) {
      const state = resolveRunDisplayState({ status: 'failed', gateStatus: gate });
      expect(state.tone, gate).not.toBe('success');
      expect(state.status, gate).toBe(gate);
      expect(isCleanRunOutcome({ status: 'failed', gateStatus: gate }), gate).toBe(false);
    }
  });

  it('prefers the gate status because it is more specific than "failed"', () => {
    expect(resolveRunDisplayState({ status: 'failed', gateStatus: 'contract_failed' }).label)
      .toBe('CONTRACT FAILED');
  });

  it('does not let a passing gate paint over a later failure', () => {
    // Gates passed, then persistence or billing failed. Not green.
    const state = resolveRunDisplayState({ status: 'failed', gateStatus: 'completed' });
    expect(state.status).toBe('failed');
    expect(state.tone).toBe('failure');
  });

  it('treats degraded output as a warning, never a success', () => {
    expect(resolveRunDisplayState({ status: 'failed', gateStatus: 'completed_degraded' }).tone)
      .toBe('warning');
  });

  it('keeps cancellation neutral rather than alarming', () => {
    expect(resolveRunDisplayState({ status: 'cancelled' }).tone).toBe('neutral');
  });

  it('marks a clean pass as the only success', () => {
    expect(resolveRunDisplayState({ status: 'completed' }).tone).toBe('success');
    expect(resolveRunDisplayState({ status: 'completed', gateStatus: 'completed' }).tone)
      .toBe('success');
  });

  it('warns rather than reassures on an unrecognised or missing status', () => {
    // A status this module has not been taught must not default to green.
    expect(resolveRunDisplayState({ status: 'some_future_state' }).tone).toBe('warning');
    expect(resolveRunDisplayState({ status: '' }).tone).toBe('warning');
    expect(resolveRunDisplayState({ status: null }).status).toBe('unknown');
    expect(resolveRunDisplayState({ status: undefined }).tone).toBe('warning');
  });

  it('renders a human label without underscores', () => {
    expect(resolveRunDisplayState({ status: 'verification_failed' }).label)
      .toBe('VERIFICATION FAILED');
    expect(resolveRunDisplayState({ status: 'completed' }).label).toBe('COMPLETED');
  });

  it('supplies a class set for every tone so no surface invents its own', () => {
    for (const tone of ['success', 'warning', 'failure', 'neutral'] as const) {
      expect(RUN_TONE_CLASSES[tone].text).toBeTruthy();
      expect(RUN_TONE_CLASSES[tone].border).toBeTruthy();
      expect(RUN_TONE_CLASSES[tone].chip).toBeTruthy();
    }
    // Only the success tone may be green.
    expect(RUN_TONE_CLASSES.success.text).toContain('green');
    for (const tone of ['warning', 'failure', 'neutral'] as const) {
      expect(RUN_TONE_CLASSES[tone].text).not.toContain('green');
      expect(RUN_TONE_CLASSES[tone].chip).not.toContain('emerald');
    }
  });
});
