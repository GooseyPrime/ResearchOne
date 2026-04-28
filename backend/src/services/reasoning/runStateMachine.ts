/**
 * Research-run state machine — single source of truth.
 *
 * Before this module, three writers (the orchestrator's row UPDATE, the
 * orchestrator's `progress_events` append, and the worker's socket payload)
 * each made their own decisions about retryable / terminal / aborted /
 * failed. They could (and did) disagree at first-failure boundary cases,
 * which produced UI states like "Retryable" badge + "not recoverable"
 * headline + "Aborted" banner all on the same screen.
 *
 * Now: the orchestrator and the retry-from-failure route call exactly one
 * function — `decideRunStateOnFailure`, `decideRunStateOnSuccess`,
 * `decideRunStateOnCancel`, or `decideRunStateOnRetryRequest` — and write
 * the result. The frontend `deriveRunState` (in `frontend/src/utils/runState.ts`)
 * is the mirror reader and produces the same canonical kind from the
 * persisted row, so the UI banner / failure card / trace badge all read
 * one shape.
 */

export type CanonicalRunStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'aborted'
  | 'cancelled';

export type CanonicalSocketEvent =
  | 'research:progress'
  | 'research:completed'
  | 'research:failed'
  | 'research:aborted'
  | 'research:cancelled';

/**
 * Canonical reason a run is non-retryable. Mapped to user copy on the
 * frontend; the backend just classifies.
 */
export type AbortReason =
  | 'budget_exhausted'
  | 'auth_error'
  | 'invalid_request'
  | 'non_recoverable_classification'
  | 'cancelled'
  | 'other';

export interface CanonicalFailureMeta {
  classification?: string;
  status?: number | string;
  providerMessage?: string;
  model?: string;
  role?: string;
  endpoint?: string;
  upstream?: string;
  /** True iff the failure is recoverable AND retry budget remains. The
   *  frontend uses this exclusively; do not derive retryability anywhere
   *  else. */
  retryable: boolean;
  /** True iff this failure is terminal (no retry will be allowed even if
   *  the user clicks Resume). When `terminal=true`, `retryable=false`. */
  terminal: boolean;
  /** Why we are terminal, when terminal=true. Empty otherwise. */
  abortReason?: AbortReason;
  retryAttempts: number;
  retryBudget: number;
  attemptsRemaining: number;
  /** Backwards compat with older readers; equal to retryable. */
  resumeAvailable: boolean;
  /** Free-form orchestrator hints — surfaced as bullet points on the
   *  frontend FailureCard but never used to derive state. */
  orchestratorHints?: string[];
  /** Hub-routed provider fallback bookkeeping (for HF -> Together case). */
  providerFallbackAttempted?: boolean;
  providerFallbackBackend?: string | null;
  providerFallbackResult?: string | null;
  /** ISO timestamp of the most recent retry-from-failure click. */
  lastRetryAt?: string;
}

export interface RunFailureInput {
  /** Free-form per-error meta from `buildResearchFailureDetails` (classification, model, etc). */
  raw: Record<string, unknown>;
  /** Underlying retryability per the upstream classifier (rate_limited / provider_unavailable / network_error). */
  classifierRetryable: boolean;
  retryAttempts: number;
  retryBudget: number;
}

export interface FailureTransition {
  nextStatus: 'failed' | 'aborted';
  failureMeta: CanonicalFailureMeta;
  socketEvent: 'research:failed' | 'research:aborted';
  /** Whether to clear progress_* columns. Always true for terminal/failure. */
  clearProgress: true;
  /** Whether to keep `resume_job_payload`. False on aborted (so retry-from-failure 400s). */
  keepResumePayload: boolean;
}

const NON_RECOVERABLE_CLASSIFICATIONS = new Set<string>([
  'auth_error',
  'bad_request',
  'invalid_request',
]);

function classToAbortReason(classification: string | undefined): AbortReason {
  if (!classification) return 'other';
  if (classification === 'auth_error') return 'auth_error';
  if (classification === 'bad_request' || classification === 'invalid_request') return 'invalid_request';
  return 'non_recoverable_classification';
}

/**
 * Decide the post-failure state for a research run.
 *
 * Inputs:
 *   - raw failure_meta (classification, role, model, endpoint, upstream,
 *     providerMessage, orchestratorHints, providerFallback*)
 *   - whether the underlying upstream classifier said retryable
 *     (rate_limited / provider_unavailable / network_error)
 *   - the row's current retry_attempts / retry_budget
 */
export function decideRunStateOnFailure(input: RunFailureInput): FailureTransition {
  const { raw, classifierRetryable, retryAttempts, retryBudget } = input;
  const classification = typeof raw.classification === 'string' ? raw.classification : undefined;

  const attemptsRemaining = Math.max(0, retryBudget - retryAttempts);
  const budgetExhausted = attemptsRemaining <= 0;

  const nonRecoverableClass = classification
    ? NON_RECOVERABLE_CLASSIFICATIONS.has(classification)
    : false;

  let nextStatus: 'failed' | 'aborted';
  let abortReason: AbortReason | undefined;
  let retryable: boolean;
  let terminal: boolean;

  if (!classifierRetryable || nonRecoverableClass) {
    // Even with budget remaining, do not offer Resume on auth/bad-request
    // errors — clicking it would just hit the same wall.
    nextStatus = 'aborted';
    abortReason = nonRecoverableClass ? classToAbortReason(classification) : 'non_recoverable_classification';
    retryable = false;
    terminal = true;
  } else if (budgetExhausted) {
    nextStatus = 'aborted';
    abortReason = 'budget_exhausted';
    retryable = false;
    terminal = true;
  } else {
    nextStatus = 'failed';
    abortReason = undefined;
    retryable = true;
    terminal = false;
  }

  const failureMeta: CanonicalFailureMeta = {
    classification,
    status: typeof raw.status === 'number' || typeof raw.status === 'string' ? raw.status : undefined,
    providerMessage: typeof raw.providerMessage === 'string' ? raw.providerMessage : undefined,
    model: typeof raw.model === 'string' ? raw.model : undefined,
    role: typeof raw.role === 'string' ? raw.role : undefined,
    endpoint: typeof raw.endpoint === 'string' ? raw.endpoint : undefined,
    upstream: typeof raw.upstream === 'string' ? raw.upstream : undefined,
    retryable,
    terminal,
    abortReason,
    retryAttempts,
    retryBudget,
    attemptsRemaining,
    resumeAvailable: retryable,
    orchestratorHints: Array.isArray(raw.orchestratorHints)
      ? (raw.orchestratorHints as unknown[]).filter((h): h is string => typeof h === 'string')
      : undefined,
    providerFallbackAttempted:
      typeof raw.providerFallbackAttempted === 'boolean' ? raw.providerFallbackAttempted : undefined,
    providerFallbackBackend:
      typeof raw.providerFallbackBackend === 'string' || raw.providerFallbackBackend === null
        ? (raw.providerFallbackBackend as string | null)
        : undefined,
    providerFallbackResult:
      typeof raw.providerFallbackResult === 'string' || raw.providerFallbackResult === null
        ? (raw.providerFallbackResult as string | null)
        : undefined,
    lastRetryAt: typeof raw.lastRetryAt === 'string' ? raw.lastRetryAt : undefined,
  };

  return {
    nextStatus,
    failureMeta,
    socketEvent: terminal ? 'research:aborted' : 'research:failed',
    clearProgress: true,
    keepResumePayload: !terminal,
  };
}

export type RetryRequestRejection =
  | { ok: false; reason: 'not_failed'; currentStatus: string }
  | { ok: false; reason: 'aborted'; currentStatus: 'aborted' }
  | { ok: false; reason: 'not_retryable'; currentStatus: string }
  | { ok: false; reason: 'budget_exhausted'; retryAttempts: number; retryBudget: number }
  | { ok: false; reason: 'no_resume_payload'; currentStatus: string }
  | { ok: false; reason: 'invalid_payload'; currentStatus: string };

export type RetryRequestAcceptance = {
  ok: true;
  nextRetryAttempts: number;
  retryBudget: number;
  attemptsRemaining: number;
  failureMeta: CanonicalFailureMeta;
};

/**
 * Decide whether a `POST /api/research/:id/retry-from-failure` request can
 * proceed. The route handler maps the rejection variants to 400 bodies with
 * explicit reason copy; on acceptance it increments `retry_attempts` and
 * re-queues the job.
 */
export function decideRunStateOnRetryRequest(input: {
  currentStatus: string;
  currentFailureMeta: Record<string, unknown> | null | undefined;
  retryAttempts: number;
  retryBudget: number;
  resumePayload: unknown;
  expectedRunId: string;
}): RetryRequestRejection | RetryRequestAcceptance {
  if (input.currentStatus === 'aborted') {
    return { ok: false, reason: 'aborted', currentStatus: 'aborted' };
  }
  if (input.currentStatus !== 'failed') {
    return { ok: false, reason: 'not_failed', currentStatus: input.currentStatus };
  }

  const fm = input.currentFailureMeta ?? {};
  const retryable = fm.retryable === true || fm.resumeAvailable === true;
  if (!retryable) {
    return { ok: false, reason: 'not_retryable', currentStatus: input.currentStatus };
  }

  if (input.retryAttempts >= input.retryBudget) {
    return {
      ok: false,
      reason: 'budget_exhausted',
      retryAttempts: input.retryAttempts,
      retryBudget: input.retryBudget,
    };
  }

  if (!input.resumePayload || typeof input.resumePayload !== 'object') {
    return { ok: false, reason: 'no_resume_payload', currentStatus: input.currentStatus };
  }

  const payloadRunId = (input.resumePayload as { runId?: unknown }).runId;
  if (typeof payloadRunId !== 'string' || payloadRunId !== input.expectedRunId) {
    return { ok: false, reason: 'invalid_payload', currentStatus: input.currentStatus };
  }

  const nextRetryAttempts = input.retryAttempts + 1;
  const attemptsRemaining = Math.max(0, input.retryBudget - nextRetryAttempts);

  // Carry forward the prior failure_meta but bump retry bookkeeping.
  const carry: Record<string, unknown> = { ...fm };
  delete carry.terminal; // we are leaving aborted/failed — start clean
  delete carry.abortReason;
  const failureMeta: CanonicalFailureMeta = {
    classification: typeof carry.classification === 'string' ? carry.classification : undefined,
    status:
      typeof carry.status === 'number' || typeof carry.status === 'string' ? (carry.status as number | string) : undefined,
    providerMessage: typeof carry.providerMessage === 'string' ? carry.providerMessage : undefined,
    model: typeof carry.model === 'string' ? carry.model : undefined,
    role: typeof carry.role === 'string' ? carry.role : undefined,
    endpoint: typeof carry.endpoint === 'string' ? carry.endpoint : undefined,
    upstream: typeof carry.upstream === 'string' ? carry.upstream : undefined,
    retryable: true,
    terminal: false,
    retryAttempts: nextRetryAttempts,
    retryBudget: input.retryBudget,
    attemptsRemaining,
    resumeAvailable: true,
    orchestratorHints: Array.isArray(carry.orchestratorHints)
      ? (carry.orchestratorHints as unknown[]).filter((h): h is string => typeof h === 'string')
      : undefined,
    providerFallbackAttempted:
      typeof carry.providerFallbackAttempted === 'boolean' ? carry.providerFallbackAttempted : undefined,
    providerFallbackBackend:
      typeof carry.providerFallbackBackend === 'string' || carry.providerFallbackBackend === null
        ? (carry.providerFallbackBackend as string | null)
        : undefined,
    providerFallbackResult:
      typeof carry.providerFallbackResult === 'string' || carry.providerFallbackResult === null
        ? (carry.providerFallbackResult as string | null)
        : undefined,
    lastRetryAt: new Date().toISOString(),
  };

  return {
    ok: true,
    nextRetryAttempts,
    retryBudget: input.retryBudget,
    attemptsRemaining,
    failureMeta,
  };
}

/**
 * Map a retry-request rejection to a structured 400 body with explicit copy.
 * The route handler returns this as JSON so the frontend FailureCard can
 * surface the reason directly.
 */
export function rejectionToHttpBody(rej: RetryRequestRejection): {
  error: string;
  reason: string;
  status: string;
  retryable: boolean;
  terminal?: boolean;
  retryAttempts?: number;
  retryBudget?: number;
} {
  switch (rej.reason) {
    case 'aborted':
      return {
        error: 'Run has been aborted',
        reason:
          'No retry attempts remain or this failure was non-recoverable. The run has been moved to status=aborted; start a new run instead.',
        status: 'aborted',
        retryable: false,
        terminal: true,
      };
    case 'not_failed':
      return {
        error: `Cannot retry while status=${rej.currentStatus}`,
        reason:
          'A worker may already be processing this run, or the run is queued / completed / cancelled. Wait for it to settle before retrying.',
        status: rej.currentStatus,
        retryable: false,
      };
    case 'not_retryable':
      return {
        error: 'This failure is not retryable',
        reason:
          'The orchestrator classified this error as non-recoverable (auth / malformed request). Inspect the failure details and start a new run.',
        status: rej.currentStatus,
        retryable: false,
      };
    case 'budget_exhausted':
      return {
        error: 'Retry budget exhausted',
        reason: `This run has used all ${rej.retryBudget} retry attempts. The run is moved to status=aborted; start a new run instead.`,
        status: 'aborted',
        retryable: false,
        terminal: true,
        retryAttempts: rej.retryAttempts,
        retryBudget: rej.retryBudget,
      };
    case 'no_resume_payload':
      return {
        error: 'No resume payload found',
        reason: 'resume_job_payload is missing — this run cannot be resumed; start a new run instead.',
        status: rej.currentStatus,
        retryable: false,
      };
    case 'invalid_payload':
      return {
        error: 'Invalid resume payload',
        reason: 'payload.runId mismatch — start a new run instead.',
        status: rej.currentStatus,
        retryable: false,
      };
  }
}
