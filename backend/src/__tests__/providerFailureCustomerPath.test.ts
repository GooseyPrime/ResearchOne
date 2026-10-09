/**
 * RJ-019. What happens to a run, and what a customer is told, when writing
 * fails because an AI provider refused.
 *
 * On main the 402 was classified as not recoverable: the run was marked
 * aborted, its payload was dropped so it could not be run again, and the page
 * showed the stored error with the step, the model and the status code in it.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../db/pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../db/pool')>()),
  query: vi.fn(async () => []),
  queryOne: vi.fn(async () => null),
}));

import { NormalizedModelError } from '../services/openrouter/openrouterService';
import { buildResearchFailureDetails } from '../services/reasoning/researchOrchestrator';
import { decideRunStateOnFailure, decideRunStateOnRetryRequest } from '../services/reasoning/runStateMachine';
import {
  CUSTOMER_FAILURE_MESSAGES,
  customerFailureMessage,
  looksLikeInternalDetail,
  runRowForCustomer,
} from '../services/reasoning/customerFailureMessage';
import { createWaitingTraceThrottle } from '../services/reasoning/traceDisplay';

const PROVIDER_TEXT =
  'This request would exceed your available credits given your current in-flight requests. Retry after in-flight requests settle, or add credits.';

function outOfCredit(): NormalizedModelError {
  return new NormalizedModelError({
    classification: 'quota_exceeded',
    status: 402,
    providerMessage: PROVIDER_TEXT,
    model: 'deepseek/deepseek-v3.2',
    upstream: 'openrouter',
    fallbackTried: true,
    role: 'section_drafter',
    routesTried: [
      { model: 'deepseek/deepseek-v3.2', provider: 'openrouter', position: 'primary', round: 1, outcome: 'refused', classification: 'quota_exceeded', status: 402 },
    ],
  });
}

/** Words and shapes no customer may be shown. */
const NOT_FOR_CUSTOMERS = [
  /role=/i,
  /model=/i,
  /status=/i,
  /classification/i,
  /section_drafter/,
  /deepseek/i,
  /\b402\b/,
  /quota/i,
  /add credits/i,
  /aborted/i,
  /non-recoverable/i,
  /openrouter/i,
  /\bclaims?\b/i,
  /steel-?man/i,
  /s[kc]eptic/i,
  /devil/i,
  /red[- ]team/i,
  /adversarial/i,
];

function expectPlain(text: string) {
  for (const pattern of NOT_FOR_CUSTOMERS) expect(text).not.toMatch(pattern);
}

/**
 * Everything in a run row except the stored status, stage and event ids. Those
 * are values the page looks up words for ("aborted" is shown as "Stopped");
 * every other string in the row can reach the screen as written.
 */
function sentWithoutIds(row: unknown): string {
  return JSON.stringify(row, (key, value: unknown) =>
    key === 'status' || key === 'stage' || key === 'failed_stage' || key === 'eventType' || key === 'customerMessageId' ? undefined : value
  );
}

describe('a run whose writing step is refused for credit', () => {
  it('stays able to be run again instead of being thrown away', () => {
    const details = buildResearchFailureDetails(outOfCredit(), 'synthesis');
    expect(details.retryable).toBe(true);

    const transition = decideRunStateOnFailure({
      raw: details.failureMeta,
      classifierRetryable: details.retryable,
      retryAttempts: 0,
      retryBudget: 3,
    });

    expect(transition.nextStatus).toBe('failed');
    expect(transition.keepResumePayload).toBe(true);
    expect(transition.failureMeta.retryable).toBe(true);
    expect(transition.failureMeta.terminal).toBe(false);

    // And the request to run it again is accepted.
    const retry = decideRunStateOnRetryRequest({
      currentStatus: transition.nextStatus,
      currentFailureMeta: transition.failureMeta as unknown as Record<string, unknown>,
      retryAttempts: 0,
      retryBudget: 3,
      resumePayload: { runId: 'run-1' },
      expectedRunId: 'run-1',
    });
    expect(retry.ok).toBe(true);
  });

  it('keeps the routes that were tried in the diagnostics', () => {
    const details = buildResearchFailureDetails(outOfCredit(), 'synthesis');
    const transition = decideRunStateOnFailure({ raw: details.failureMeta, classifierRetryable: true, retryAttempts: 0, retryBudget: 3 });
    expect(transition.failureMeta.routesTried).toHaveLength(1);
    // The stored error keeps every detail, for whoever has to fix it.
    expect(details.errorMessage).toContain('status=402');
    expect(details.errorMessage).toContain('section_drafter');
  });

  it('still stops for good once the allowed number of tries is used up', () => {
    const details = buildResearchFailureDetails(outOfCredit(), 'synthesis');
    const transition = decideRunStateOnFailure({ raw: details.failureMeta, classifierRetryable: details.retryable, retryAttempts: 3, retryBudget: 3 });
    expect(transition.nextStatus).toBe('aborted');
  });
});

describe('what a customer is told', () => {
  it('is a plain sentence, for every failure message there is', () => {
    for (const text of Object.values(CUSTOMER_FAILURE_MESSAGES)) {
      expectPlain(text);
      expect(text).toMatch(/You have not been charged\./);
      expect(text).toMatch(/Run it again/);
    }
  });

  it('says the report could not be written when the writing step was refused', () => {
    const message = customerFailureMessage({ classification: 'quota_exceeded', stage: 'synthesis' });
    expect(message.id).toBe('ai_service_unavailable_writing');
    expect(message.text).toMatch(/^The report could not be written because our AI service is temporarily unavailable\./);
  });

  it('does not promise that finished work is reused, because running again starts over', () => {
    for (const text of Object.values(CUSTOMER_FAILURE_MESSAGES)) {
      expect(text).not.toMatch(/saved|resume|picks up|where it left off/i);
    }
  });

  const storedRow = () => {
    const details = buildResearchFailureDetails(outOfCredit(), 'synthesis');
    const meta = { ...details.failureMeta, ...customerMessageFields('quota_exceeded', 'synthesis'), retryable: true, terminal: false };
    return {
      id: 'run-1',
      status: 'failed',
      failed_stage: 'synthesis',
      error_message: details.errorMessage,
      failure_meta: meta,
      model_log: [{ role: 'section_drafter', model: 'deepseek/deepseek-v3.2' }],
      resume_job_payload: { runId: 'run-1', creditChargeContext: { holdId: 'h1' } },
      progress_events: [
        { stage: 'discovery', percent: 16, message: 'Reading the sources found: 18/25 ready', internalDetail: 'pending=6; failed=1; waited=3000ms', sourceCount: 18 },
        { stage: 'discovery', percent: 16, message: 'Reading the sources found: 18/25 ready', detail: 'pending=6; failed=1; waited=6000ms' },
        { stage: 'retrieval', percent: 21, message: 'Search 1/3 of your library complete', detail: 'heat pump payback period', model: 'deepseek/deepseek-v3.2', tokenUsage: { prompt: 10, completion: 2 } },
        {
          stage: 'aborted',
          percent: 80,
          eventType: 'run_aborted',
          message: 'Run aborted — failure was non-recoverable. Writing the report section by section...',
          failure: { errorMessage: details.errorMessage, retryable: false, failureMeta: details.failureMeta },
        },
      ],
    };
  };

  function customerMessageFields(classification: string, stage: string) {
    const message = customerFailureMessage({ classification, stage });
    return { customerMessageId: message.id, customerMessage: message.text };
  }

  it('replaces the stored error and strips the diagnostics from the run a customer is sent', () => {
    const sent = runRowForCustomer(storedRow()) as unknown as Record<string, unknown>;

    expect(sent.error_message).toBe(CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable_writing);
    expect(sent.model_log).toBeUndefined();
    expect(sent.resume_job_payload).toBeUndefined();
    expect(sent.failure_meta).toMatchObject({ retryable: true, terminal: false });
    // Nothing a customer is sent, anywhere in the row, carries the raw detail.
    expectPlain(sentWithoutIds(sent));
  });

  it('keeps what the customer typed and what the run did, and drops only the internal detail', () => {
    const sent = runRowForCustomer(storedRow()) as unknown as { progress_events: Array<Record<string, unknown>> };
    const [waiting, olderWaiting, search, stopped] = sent.progress_events;
    expect(waiting.message).toBe('Reading the sources found: 18/25 ready');
    expect(waiting.internalDetail).toBeUndefined();
    expect(waiting.sourceCount).toBe(18);
    expect(olderWaiting.detail).toBeUndefined();
    expect(search.detail).toBe('heat pump payback period');
    expect(search.model).toBeUndefined();
    expect(search.tokenUsage).toBeUndefined();
    expect(stopped.message).toBe(CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable_writing);
  });

  it('gives a run stored before this change a plain sentence too', () => {
    const row = storedRow();
    const { customerMessage: _text, customerMessageId: _id, ...older } = row.failure_meta as Record<string, unknown>;
    void _text;
    void _id;
    const sent = runRowForCustomer({ ...row, status: 'aborted', failure_meta: older }) as unknown as Record<string, unknown>;
    expect(sent.error_message).toBe(CUSTOMER_FAILURE_MESSAGES.ai_service_unavailable_writing);
    expectPlain(sentWithoutIds(sent));
  });

  it('leaves a report that failed a check to the page that already explains it', () => {
    const sent = runRowForCustomer({ id: 'r', status: 'failed', error_message: null, failure_meta: { gate_status: 'contract_failed' } }) as unknown as Record<string, unknown>;
    expect(sent.error_message).toBeNull();
    expect(sent.failure_meta).toEqual({ gate_status: 'contract_failed' });
  });

  it('leaves a run that did not fail alone', () => {
    const run = { id: 'r', status: 'completed', error_message: null, failure_meta: null, progress_events: [] };
    expect(runRowForCustomer(run)).toEqual(run);
  });

  it('knows internal detail from words a person wrote', () => {
    expect(looksLikeInternalDetail('pending=6; failed=1; waited=3000ms')).toBe(true);
    expect(looksLikeInternalDetail('ready=18/25')).toBe(true);
    expect(looksLikeInternalDetail('no_sources_ingested')).toBe(true);
    expect(looksLikeInternalDetail('heat pump payback period')).toBe(false);
    expect(looksLikeInternalDetail('Does x=y hold for small firms?')).toBe(false);
  });
});

describe('a wait that is not moving', () => {
  it('writes one line, not one every three seconds', () => {
    const throttle = createWaitingTraceThrottle(60_000);
    let written = 0;
    // Two minutes of "18/25 ready", reported every three seconds, as in the run.
    for (let ms = 0; ms < 120_000; ms += 3_000) {
      if (throttle.shouldWrite('18/25', ms)) written += 1;
    }
    // The first line, and one a minute after it to show the run is alive.
    expect(written).toBe(2);
  });

  it('writes again as soon as the count changes', () => {
    const throttle = createWaitingTraceThrottle(60_000);
    expect(throttle.shouldWrite('18/25', 0)).toBe(true);
    expect(throttle.shouldWrite('18/25', 3_000)).toBe(false);
    expect(throttle.shouldWrite('19/25', 6_000)).toBe(true);
    expect(throttle.shouldWrite('19/25', 9_000)).toBe(false);
  });
});
