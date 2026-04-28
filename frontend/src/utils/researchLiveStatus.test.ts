import { describe, expect, it } from 'vitest';
import {
  classifyLiveStatus,
  LIVE_STATUS_COPY,
  deriveRunState,
  isResumeAvailable,
  failureCardHeadline,
  badgeForState,
} from './researchLiveStatus';

/**
 * Locks in the contract reviewed in PR #39: the `'retrying'` LiveStatus
 * variant is reachable. The previous classifier never returned it because
 * it did not see retry context, so `LIVE_STATUS_COPY.retrying` was dead
 * code (Copilot review).
 */
describe('classifyLiveStatus', () => {
  it('aborted wins over everything (terminal failure)', () => {
    expect(classifyLiveStatus('failed', { terminal: true })).toBe('aborted');
    expect(classifyLiveStatus('aborted', null)).toBe('aborted');
  });

  it('failed with retryable=false collapses to aborted', () => {
    expect(classifyLiveStatus('failed', { retryable: false })).toBe('aborted');
  });

  it('failed with retryable=true is failed_retryable', () => {
    expect(classifyLiveStatus('failed', { retryable: true })).toBe('failed_retryable');
  });

  it('queued + retry_attempts > 0 routes to retrying', () => {
    expect(classifyLiveStatus('queued', null, { retryAttempts: 1 })).toBe('retrying');
  });

  it('queued + progress_message hints at retry routes to retrying', () => {
    expect(
      classifyLiveStatus('queued', null, {
        retryAttempts: 0,
        progressMessage: 'Retry queued from failure',
      })
    ).toBe('retrying');
  });

  it('running with retry_attempts > 0 routes to retrying (mid-attempt)', () => {
    expect(classifyLiveStatus('running', null, { retryAttempts: 2 })).toBe('retrying');
  });

  it('running with no retry context routes to running', () => {
    expect(classifyLiveStatus('running', null)).toBe('running');
  });

  it('queued with no retry context stays queued', () => {
    expect(classifyLiveStatus('queued', null)).toBe('queued');
  });

  it('completed and cancelled pass through', () => {
    expect(classifyLiveStatus('completed', null)).toBe('completed');
    expect(classifyLiveStatus('cancelled', null)).toBe('cancelled');
  });

  it('every LiveStatus variant has copy', () => {
    for (const k of Object.keys(LIVE_STATUS_COPY)) {
      expect(LIVE_STATUS_COPY[k as keyof typeof LIVE_STATUS_COPY].label).toBeTruthy();
    }
  });
});

describe('deriveRunState — single source of truth', () => {
  it('first failure with retryable=true and budget remaining → failed_retryable', () => {
    expect(
      deriveRunState({
        status: 'failed',
        failure_meta: {
          retryable: true,
          terminal: false,
          retryAttempts: 0,
          retryBudget: 3,
        },
      })
    ).toBe('failed_retryable');
  });

  it('failure with terminal=true → aborted (regardless of retryable hint)', () => {
    expect(
      deriveRunState({
        status: 'failed',
        failure_meta: {
          retryable: true, // contradictory; terminal wins
          terminal: true,
          retryAttempts: 3,
          retryBudget: 3,
        },
      })
    ).toBe('aborted');
  });

  it('row.status=aborted always wins regardless of meta', () => {
    expect(
      deriveRunState({
        status: 'aborted',
        failure_meta: { retryable: true },
      })
    ).toBe('aborted');
  });

  it('row.failure_meta lacks retryable+terminal → aborted (no Resume button)', () => {
    // This was the post-merge scenario: the row had a partial/legacy
    // failure_meta with neither retryable nor terminal set, and the UI
    // showed "Aborted" banner + "Retryable" badge. With the canonical
    // reader the result is now consistently 'aborted' (no Resume) — the
    // old "Retryable" badge can never appear because nothing else
    // computes the badge anymore.
    expect(
      deriveRunState({
        status: 'failed',
        failure_meta: {
          classification: 'provider_unavailable',
          model: 'nousresearch/hermes-4-70b',
          // no retryable, no terminal
        },
      })
    ).toBe('aborted');
  });

  it('transient socket payload with retryable=true is honored even if persisted row has not caught up', () => {
    expect(
      deriveRunState(
        { status: 'failed', failure_meta: {} },
        { retryable: true, failureMeta: { retryable: true } }
      )
    ).toBe('failed_retryable');
  });

  it('queued + retry_attempts > 0 → retrying', () => {
    expect(deriveRunState({ status: 'queued', retry_attempts: 1 })).toBe('retrying');
  });

  it('completed and cancelled pass through', () => {
    expect(deriveRunState({ status: 'completed' })).toBe('completed');
    expect(deriveRunState({ status: 'cancelled' })).toBe('cancelled');
  });
});

describe('isResumeAvailable / failureCardHeadline / badgeForState', () => {
  it('Resume only on failed_retryable', () => {
    expect(isResumeAvailable('failed_retryable')).toBe(true);
    expect(isResumeAvailable('aborted')).toBe(false);
    expect(isResumeAvailable('running')).toBe(false);
    expect(isResumeAvailable('queued')).toBe(false);
    expect(isResumeAvailable('completed')).toBe(false);
  });

  it('headline only fires on failure states', () => {
    expect(failureCardHeadline('aborted')).toMatch(/aborted/i);
    expect(failureCardHeadline('failed_retryable')).toMatch(/recoverable/i);
    expect(failureCardHeadline('running')).toBeNull();
    expect(failureCardHeadline('queued')).toBeNull();
    expect(failureCardHeadline('completed')).toBeNull();
  });

  it('badgeForState aborted=terminal, failed_retryable=retryable, retrying=resumed', () => {
    expect(badgeForState('aborted')?.variant).toBe('terminal');
    expect(badgeForState('failed_retryable')?.variant).toBe('retryable');
    expect(badgeForState('retrying')?.variant).toBe('resumed');
    expect(badgeForState('running')).toBeNull();
  });
});
