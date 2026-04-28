import { describe, expect, it } from 'vitest';
import { classifyLiveStatus, LIVE_STATUS_COPY } from './researchLiveStatus';

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
