import { describe, expect, it } from 'vitest';
import {
  decideRunStateOnFailure,
  decideRunStateOnRetryRequest,
  rejectionToHttpBody,
} from '../services/reasoning/runStateMachine';

/**
 * Locks in the contract that drives the post-PR-39 state machine: one
 * function decides retryable / terminal / aborted-vs-failed for every
 * downstream consumer (row UPDATE, progress_event, socket event). All UI
 * banners, badges, and failure cards must read from the canonical output
 * of this function — no parallel paths.
 */
describe('decideRunStateOnFailure', () => {
  const PROVIDER_UNAVAILABLE_RAW = {
    classification: 'provider_unavailable',
    role: 'planner',
    model: 'nousresearch/hermes-4-70b',
    upstream: 'openrouter',
    providerMessage: 'Hugging Face inference failed before or during model execution',
  };

  it('first attempt with budget remaining: retryable=true, terminal=false, status=failed', () => {
    const t = decideRunStateOnFailure({
      raw: PROVIDER_UNAVAILABLE_RAW,
      classifierRetryable: true,
      retryAttempts: 0,
      retryBudget: 3,
    });
    expect(t.nextStatus).toBe('failed');
    expect(t.socketEvent).toBe('research:failed');
    expect(t.failureMeta.retryable).toBe(true);
    expect(t.failureMeta.terminal).toBe(false);
    expect(t.failureMeta.attemptsRemaining).toBe(3);
    expect(t.failureMeta.abortReason).toBeUndefined();
    expect(t.keepResumePayload).toBe(true);
  });

  it('budget exhausted: terminal=true, abortReason=budget_exhausted, status=aborted, no resume', () => {
    const t = decideRunStateOnFailure({
      raw: PROVIDER_UNAVAILABLE_RAW,
      classifierRetryable: true,
      retryAttempts: 3,
      retryBudget: 3,
    });
    expect(t.nextStatus).toBe('aborted');
    expect(t.socketEvent).toBe('research:aborted');
    expect(t.failureMeta.retryable).toBe(false);
    expect(t.failureMeta.terminal).toBe(true);
    expect(t.failureMeta.abortReason).toBe('budget_exhausted');
    expect(t.failureMeta.attemptsRemaining).toBe(0);
    expect(t.keepResumePayload).toBe(false);
  });

  it('classifier says non-retryable (network drop): aborted with non_recoverable_classification', () => {
    const t = decideRunStateOnFailure({
      raw: { ...PROVIDER_UNAVAILABLE_RAW, classification: undefined },
      classifierRetryable: false,
      retryAttempts: 0,
      retryBudget: 3,
    });
    expect(t.nextStatus).toBe('aborted');
    expect(t.failureMeta.terminal).toBe(true);
    expect(t.failureMeta.retryable).toBe(false);
    expect(t.failureMeta.abortReason).toBe('non_recoverable_classification');
  });

  it('auth_error short-circuits to aborted regardless of budget', () => {
    const t = decideRunStateOnFailure({
      raw: { ...PROVIDER_UNAVAILABLE_RAW, classification: 'auth_error' },
      classifierRetryable: true, // upstream said retryable but auth wins
      retryAttempts: 0,
      retryBudget: 3,
    });
    expect(t.nextStatus).toBe('aborted');
    expect(t.failureMeta.abortReason).toBe('auth_error');
    expect(t.failureMeta.retryable).toBe(false);
    expect(t.failureMeta.terminal).toBe(true);
  });

  it('bad_request short-circuits to aborted with invalid_request reason', () => {
    const t = decideRunStateOnFailure({
      raw: { ...PROVIDER_UNAVAILABLE_RAW, classification: 'bad_request' },
      classifierRetryable: true,
      retryAttempts: 0,
      retryBudget: 3,
    });
    expect(t.nextStatus).toBe('aborted');
    expect(t.failureMeta.abortReason).toBe('invalid_request');
    expect(t.failureMeta.terminal).toBe(true);
  });

  it('failureMeta carries forward role / model / upstream / classification', () => {
    const t = decideRunStateOnFailure({
      raw: PROVIDER_UNAVAILABLE_RAW,
      classifierRetryable: true,
      retryAttempts: 1,
      retryBudget: 3,
    });
    expect(t.failureMeta.role).toBe('planner');
    expect(t.failureMeta.model).toBe('nousresearch/hermes-4-70b');
    expect(t.failureMeta.upstream).toBe('openrouter');
    expect(t.failureMeta.classification).toBe('provider_unavailable');
    expect(t.failureMeta.providerMessage).toBe(
      'Hugging Face inference failed before or during model execution'
    );
  });

  it('retryable and resumeAvailable are always equal', () => {
    for (const attempts of [0, 1, 2, 3]) {
      const t = decideRunStateOnFailure({
        raw: PROVIDER_UNAVAILABLE_RAW,
        classifierRetryable: true,
        retryAttempts: attempts,
        retryBudget: 3,
      });
      expect(t.failureMeta.retryable).toBe(t.failureMeta.resumeAvailable);
    }
  });
});

describe('decideRunStateOnRetryRequest', () => {
  const RESUME_PAYLOAD = { runId: 'run-1', query: 'q' };

  it('rejects when status=running', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'running',
      currentFailureMeta: null,
      retryAttempts: 0,
      retryBudget: 3,
      resumePayload: RESUME_PAYLOAD,
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_failed');
  });

  it('rejects when status=aborted', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'aborted',
      currentFailureMeta: { terminal: true, retryable: false },
      retryAttempts: 3,
      retryBudget: 3,
      resumePayload: RESUME_PAYLOAD,
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('aborted');
  });

  it('rejects when failure_meta says not retryable', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'failed',
      currentFailureMeta: { retryable: false, resumeAvailable: false },
      retryAttempts: 0,
      retryBudget: 3,
      resumePayload: RESUME_PAYLOAD,
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('not_retryable');
  });

  it('rejects when budget is exhausted even with retryable=true', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'failed',
      currentFailureMeta: { retryable: true },
      retryAttempts: 3,
      retryBudget: 3,
      resumePayload: RESUME_PAYLOAD,
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('budget_exhausted');
  });

  it('rejects when payload runId mismatches', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'failed',
      currentFailureMeta: { retryable: true },
      retryAttempts: 0,
      retryBudget: 3,
      resumePayload: { runId: 'other' },
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('invalid_payload');
  });

  it('accepts on first failure with budget remaining and increments attempts', () => {
    const r = decideRunStateOnRetryRequest({
      currentStatus: 'failed',
      currentFailureMeta: { retryable: true, role: 'planner' },
      retryAttempts: 0,
      retryBudget: 3,
      resumePayload: RESUME_PAYLOAD,
      expectedRunId: 'run-1',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.nextRetryAttempts).toBe(1);
      expect(r.attemptsRemaining).toBe(2);
      expect(r.failureMeta.role).toBe('planner');
      expect(r.failureMeta.terminal).toBe(false);
      expect(r.failureMeta.retryable).toBe(true);
      expect(typeof r.failureMeta.lastRetryAt).toBe('string');
    }
  });
});

describe('rejectionToHttpBody', () => {
  it('aborted: terminal=true, retryable=false', () => {
    const body = rejectionToHttpBody({
      ok: false,
      reason: 'aborted',
      currentStatus: 'aborted',
    });
    expect(body.terminal).toBe(true);
    expect(body.retryable).toBe(false);
    expect(body.status).toBe('aborted');
  });

  it('budget_exhausted: includes attempt counts', () => {
    const body = rejectionToHttpBody({
      ok: false,
      reason: 'budget_exhausted',
      retryAttempts: 3,
      retryBudget: 3,
    });
    expect(body.terminal).toBe(true);
    expect(body.retryAttempts).toBe(3);
    expect(body.retryBudget).toBe(3);
  });

  it('not_retryable: clear copy about non-recoverable classification', () => {
    const body = rejectionToHttpBody({
      ok: false,
      reason: 'not_retryable',
      currentStatus: 'failed',
    });
    expect(body.retryable).toBe(false);
    expect(body.reason).toMatch(/non-recoverable/i);
  });
});
