import { describe, it, expect } from 'vitest';

import {
  isCleanRunOutcome,
  plainReportStatus,
  plainRunStatus,
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
      .toBe('Needs review: part of the request is missing');
  });

  it('does not let a passing gate paint over a later failure', () => {
    // Gates passed, then persistence or billing failed. Never painted as success.
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
    // A status this module has not been taught must not default to success styling.
    expect(resolveRunDisplayState({ status: 'some_future_state' }).tone).toBe('warning');
    expect(resolveRunDisplayState({ status: '' }).tone).toBe('warning');
    expect(resolveRunDisplayState({ status: null }).status).toBe('unknown');
    expect(resolveRunDisplayState({ status: undefined }).tone).toBe('warning');
  });

  it('labels every status in plain words, never the stored value', () => {
    expect(resolveRunDisplayState({ status: 'verification_failed' }).label).toBe('Needs review: did not pass checking');
    expect(resolveRunDisplayState({ status: 'completed' }).label).toBe('Ready');
    expect(resolveRunDisplayState({ status: 'failed', gateStatus: 'completed_degraded' }).label).toBe('Finished with fewer sources than planned');
    const stored = ['completed', 'completed_degraded', 'contract_failed', 'verification_failed', 'no_evidence', 'failed', 'aborted', 'cancelled', 'queued', 'running', 'plan_pending_confirmation', 'some_future_state', ''];
    for (const status of stored) {
      const { label } = resolveRunDisplayState({ status });
      expect(label, status).not.toMatch(/_/);
      expect(label, status).not.toMatch(/\b(COMPLETED|DEGRADED|CONTRACT|FAILED)\b/);
      if (status.includes('_')) expect(label.toLowerCase(), status).not.toContain(status.replace(/_/g, ' '));
    }
    expect(resolveRunDisplayState({ status: 'some_future_state' }).label).toBe('Status not available');
  });

  it('puts a saved report\'s state in plain words', () => {
    expect(plainReportStatus('under_review')).toBe('Needs review');
    expect(plainReportStatus('finalized')).toBe('Ready');
    expect(plainReportStatus('generating')).toBe('Being written');
    expect(plainReportStatus('something_else')).toBe('Status not available');
    expect(plainRunStatus('RUNNING')).toBe('In progress');
  });

  it('supplies a class set for every tone so no surface invents its own', () => {
    for (const tone of ['success', 'warning', 'failure', 'neutral'] as const) {
      expect(RUN_TONE_CLASSES[tone].text).toBeTruthy();
      expect(RUN_TONE_CLASSES[tone].border).toBeTruthy();
      expect(RUN_TONE_CLASSES[tone].chip).toBeTruthy();
    }
    // House style avoids traffic-light colours; tones should use the SLATE INK palette.
    expect(RUN_TONE_CLASSES.success.text).toContain('r1-cyan');
    for (const tone of ['warning', 'failure', 'neutral'] as const) {
      expect(RUN_TONE_CLASSES[tone].text).not.toMatch(/green|emerald|amber|red|rose/);
      expect(RUN_TONE_CLASSES[tone].chip).not.toMatch(/green|emerald|amber|red|rose/);
    }
  });
});
