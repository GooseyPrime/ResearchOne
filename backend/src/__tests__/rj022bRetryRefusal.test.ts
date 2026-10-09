/**
 * RJ-022B. What a person is told when a run cannot be run again.
 *
 * Seen live on 9 Oct 2026 for run 6622a18a: `POST /research/:id/retry-from-failure`
 * answered 400 with `error: "This failure is not retryable"` and a `reason`
 * written for whoever fixes the pipeline ("The orchestrator classified this
 * error as non-recoverable (auth / malformed request). Inspect the failure
 * details and start a new run."). The run page printed it for a customer.
 *
 * The run had stopped on a provider that was out of credit (HTTP 402) before
 * RJ-019 (#274) shipped. At that time only a rate limit or an outage was
 * written down as recoverable, so the row was stored with `retryable: false`
 * and without the saved job a second attempt needs. The row is not rewritten:
 * such a run stays one that cannot be run again, and the way on is the same
 * request sent as a new one. The last group of tests holds that.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ userId: 'user_owner', adminIds: [] as string[], queryMock: vi.fn() }));

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction
    ) => {
      req.auth = { userId: state.userId, orgId: null, sessionId: null };
      next();
    },
  };
});

vi.mock('../db/pool', () => ({
  query: state.queryMock,
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: vi.fn(),
  rlsStore: {
    run: <T>(_ctx: unknown, fn: () => T): T => fn(),
    getStore: () => undefined,
  },
}));

vi.mock('../services/auth/adminAllowlist', () => ({
  isAllowlistedAdminUserId: (userId: string | null | undefined) => Boolean(userId) && state.adminIds.includes(String(userId)),
}));

const queueAdd = vi.hoisted(() => vi.fn());
vi.mock('../queue/queues', () => ({
  researchQueue: { add: queueAdd, getJob: vi.fn().mockResolvedValue(null) },
  intellmeDeletionQueue: { add: vi.fn() },
}));

import request from 'supertest';
import testApp from '../api/app';
import {
  CUSTOMER_FAILURE_MESSAGES,
  RETRY_NOT_STOPPED_MESSAGE,
  RETRY_REFUSED_MESSAGE,
  progressEventsForCustomer,
  runRowForCustomer,
  sentenceForRunThatCannotRunAgain,
} from '../services/reasoning/customerFailureMessage';
import {
  decideRunStateOnFailure,
  decideRunStateOnRetryRequest,
  rejectionToHttpBody,
  retryRefusalForCustomer,
  type RetryRequestRejection,
} from '../services/reasoning/runStateMachine';

const RUN_ID = '6622a18a-03f0-4317-a839-ddf2b73132cd';

/** What the route answered before this change. */
const OLD_REASON =
  'The orchestrator classified this error as non-recoverable (auth / malformed request). Inspect the failure details and start a new run.';

/** `failure_meta` as the run stored it when a 402 was not yet a recoverable failure. */
const STORED_402_META = {
  classification: 'quota_exceeded',
  status: 402,
  providerMessage: 'This request would exceed your available credits given your current in-flight requests.',
  model: 'deepseek/deepseek-v3.2',
  role: 'section_drafter',
  upstream: 'openrouter',
  retryable: false,
  terminal: true,
  abortReason: 'non_recoverable_classification',
  resumeAvailable: false,
  retryAttempts: 0,
  retryBudget: 2,
};

/** Words a customer is never shown as a role, and the shapes of an internal code. */
const NOT_FOR_CUSTOMERS =
  /claims|steel-?man|s[kc]eptic|devil|red[- ]?team|adversarial|orchestrator|classif|non-recoverable|malformed|payload|status=|\bauth\b|\bbudget\b|\btier\b|\bgrade\b|[a-z]+_[a-z]+/i;

const REJECTIONS: RetryRequestRejection[] = [
  { ok: false, reason: 'aborted', currentStatus: 'aborted' },
  { ok: false, reason: 'not_failed', currentStatus: 'running' },
  { ok: false, reason: 'not_retryable', currentStatus: 'failed' },
  { ok: false, reason: 'budget_exhausted', retryAttempts: 2, retryBudget: 2 },
  { ok: false, reason: 'no_resume_payload', currentStatus: 'failed' },
  { ok: false, reason: 'invalid_payload', currentStatus: 'failed' },
];

describe('RJ-022B: the sentence for a refused "run it again"', () => {
  it('is the plain sentence, and names the button the run page offers', () => {
    expect(RETRY_REFUSED_MESSAGE).toBe(
      "This request can't be run again. Press Send it as a new request to start it fresh; you have not been charged."
    );
  });

  it.each(REJECTIONS)('refusal "$reason": `error` is a sentence a customer can read', (rejection) => {
    const body = rejectionToHttpBody(rejection);
    expect(body.error).toBe(rejection.reason === 'not_failed' ? RETRY_NOT_STOPPED_MESSAGE : RETRY_REFUSED_MESSAGE);
    expect(body.error).not.toMatch(NOT_FOR_CUSTOMERS);
    expect(body.error).not.toBe('This failure is not retryable');
    expect(body.retryable).toBe(false);
    expect(body.code).toBe(rejection.reason);
  });

  it.each(REJECTIONS)('refusal "$reason": the reason is kept for administrators and taken off for everyone else', (rejection) => {
    const body = rejectionToHttpBody(rejection);
    expect(typeof body.reason).toBe('string');
    const sent = retryRefusalForCustomer(body);
    expect('reason' in sent).toBe(false);
    expect(JSON.stringify(sent)).not.toMatch(/orchestrator|non-recoverable|malformed|resume_job_payload|status=/i);
    // What the page's own logic reads is still there.
    expect(sent.status).toBe(body.status);
    expect(sent.terminal).toBe(body.terminal);
  });
});

describe('RJ-022B: POST /api/research/:id/retry-from-failure for the run of 9 Oct 2026', () => {
  beforeEach(() => {
    state.userId = 'user_owner';
    state.adminIds = [];
    queueAdd.mockReset();
    state.queryMock.mockReset();
    state.queryMock.mockImplementation(async (sql: string) => {
      const text = String(sql);
      if (text.startsWith('SELECT 1 FROM research_runs')) return [{ '?column?': 1 }];
      if (text.includes('FROM research_runs WHERE id=$1')) {
        return [{ id: RUN_ID, status: 'failed', failure_meta: STORED_402_META, resume_job_payload: null, retry_attempts: 0, retry_budget: 2 }];
      }
      return [];
    });
  });

  it('a customer is answered with the plain sentence and no reason', async () => {
    const res = await request(testApp).post(`/api/research/${RUN_ID}/retry-from-failure`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RETRY_REFUSED_MESSAGE);
    expect(res.body.reason).toBeUndefined();
    expect(res.body.retryable).toBe(false);
    expect(JSON.stringify(res.body)).not.toContain(OLD_REASON);
    expect(JSON.stringify(res.body)).not.toMatch(/orchestrator|non-recoverable|malformed/i);
  });

  it('an administrator is answered with the same sentence, and why', async () => {
    state.adminIds = ['user_owner'];
    const res = await request(testApp).post(`/api/research/${RUN_ID}/retry-from-failure`).send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe(RETRY_REFUSED_MESSAGE);
    expect(res.body.code).toBe('not_retryable');
    expect(res.body.reason).toMatch(/non-recoverable/i);
  });

  it('nothing is written and nothing is queued', async () => {
    await request(testApp).post(`/api/research/${RUN_ID}/retry-from-failure`).send({});

    const writes = state.queryMock.mock.calls.map((call) => String(call[0])).filter((sql) => /^\s*(?:UPDATE|INSERT|DELETE)\b/i.test(sql));
    expect(writes).toEqual([]);
    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('RJ-022B: the failure sentence of a run that cannot be run again', () => {
  const row = (meta: Record<string, unknown>) => ({
    id: RUN_ID,
    status: 'failed',
    failed_stage: 'synthesis',
    error_message: 'Model provider request failed at synthesis (role=section_drafter, status=402)',
    failure_meta: meta,
    progress_events: [
      { runId: RUN_ID, stage: 'failed', percent: 81, message: 'Run failed. status=402', eventType: 'run_failed', failure: { errorMessage: 'status=402', retryable: meta.retryable === true, failureMeta: meta } },
    ],
  });

  it('does not tell a customer to press "Run it again": it names "Send it as a new request"', () => {
    const sent = runRowForCustomer(row(STORED_402_META)) as unknown as { error_message: string; progress_events: Array<{ message: string; failure: { errorMessage: string } }> };

    expect(sent.error_message).toBe(
      'The report could not be written because our AI service is temporarily unavailable. You have not been charged. Press Send it as a new request to start it fresh; you are only charged once, when a report is delivered.'
    );
    expect(sent.error_message).not.toContain('Run it again');
    expect(sent.progress_events[0].message).toBe(sent.error_message);
    expect(sent.progress_events[0].failure.errorMessage).toBe(sent.error_message);
    expect(JSON.stringify(sent)).not.toMatch(/402|section_drafter|quota_exceeded/);
  });

  it('still tells a customer to press "Run it again" when the run can be', () => {
    const sent = runRowForCustomer(row({ ...STORED_402_META, retryable: true, terminal: false, resumeAvailable: true })) as unknown as { error_message: string };
    expect(sent.error_message).toBe(CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable_writing);
    expect(sent.error_message).toContain('Press Run it again');
  });

  it('rewrites a stored customer sentence too, once the run can no longer be run again', () => {
    const stored = CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable;
    const sent = runRowForCustomer(row({ ...STORED_402_META, customerMessage: stored })) as unknown as { error_message: string; failure_meta: { customerMessage: string } };
    expect(sent.error_message).toBe(sentenceForRunThatCannotRunAgain(stored));
    expect(sent.failure_meta.customerMessage).toBe(sent.error_message);
    expect(sent.error_message).not.toContain('Run it again');
  });

  it('the trace names the same button as the sentence above it, whatever the stored event says', () => {
    // A run that can be run again, whose stored stop line says it could not be.
    const stale = row({ ...STORED_402_META, retryable: true, terminal: false });
    stale.progress_events[0].failure.retryable = false;
    const again = runRowForCustomer(stale) as unknown as { error_message: string; progress_events: Array<{ message: string }> };
    expect(again.error_message).toContain('Press Run it again');
    expect(again.progress_events[0].message).toBe(again.error_message);

    // And the other way round, on the diagnostics endpoint, which is given the run's status and stored record.
    const stopped = row(STORED_402_META);
    stopped.progress_events[0].failure.retryable = true;
    const [event] = progressEventsForCustomer(stopped.progress_events, {
      classification: 'quota_exceeded',
      stage: 'synthesis',
      status: 'failed',
      failureMeta: STORED_402_META,
    }) as Array<{ message: string }>;
    expect(event.message).toContain('Press Send it as a new request');
  });

  it('the diagnostics trace says the same', () => {
    const [event] = progressEventsForCustomer(row(STORED_402_META).progress_events, { classification: 'quota_exceeded', stage: 'synthesis' }) as Array<{ message: string }>;
    expect(event.message).toContain('Press Send it as a new request');
    expect(event.message).not.toContain('Run it again');
  });

  it('leaves text that is not one of the customer sentences as it is', () => {
    expect(sentenceForRunThatCannotRunAgain('The report was produced but did not pass verification against its evidence.')).toBe(
      'The report was produced but did not pass verification against its evidence.'
    );
  });
});

describe('RJ-022B: why the run of 9 Oct 2026 cannot be run again', () => {
  it('the stored row says so, and the retry rule reads the stored row', () => {
    const decision = decideRunStateOnRetryRequest({
      currentStatus: 'failed',
      currentFailureMeta: STORED_402_META,
      retryAttempts: 0,
      retryBudget: 2,
      resumePayload: null,
      expectedRunId: RUN_ID,
    });
    expect(decision).toEqual({ ok: false, reason: 'not_retryable', currentStatus: 'failed' });
  });

  it('the same failure today is written down as one that can be run again (RJ-019)', () => {
    // Since #274 the orchestrator calls an out-of-credit answer recoverable
    // (`classifierRetryable: true`). Before it, only a rate limit or an outage was.
    const today = decideRunStateOnFailure({
      raw: { classification: 'quota_exceeded', status: 402 },
      classifierRetryable: true,
      retryAttempts: 0,
      retryBudget: 2,
    });
    expect(today.nextStatus).toBe('failed');
    expect(today.failureMeta.retryable).toBe(true);
    expect(today.keepResumePayload).toBe(true);

    const before = decideRunStateOnFailure({
      raw: { classification: 'quota_exceeded', status: 402 },
      classifierRetryable: false,
      retryAttempts: 0,
      retryBudget: 2,
    });
    expect(before.failureMeta.retryable).toBe(false);
    // The saved job a second attempt needs was not kept, so the old row could
    // not be run again even if it were re-read under today's rule.
    expect(before.keepResumePayload).toBe(false);
  });
});
