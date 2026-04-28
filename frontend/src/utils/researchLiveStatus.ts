/**
 * Single-source-of-truth reader of research run state, mirroring the
 * backend `runStateMachine.ts`. Every UI surface (live status banner,
 * trace badge, failure card headline + Resume button visibility, run-row
 * label) reads only from `deriveRunState(run, transientFailure)`. Two
 * surfaces cannot disagree because there is only one classifier.
 *
 * Background: pre-2026-04-28 the page had three independent classifiers
 * (free-text on progress events for badges, `failure.retryable` for
 * Resume button visibility, `LIVE_STATUS_COPY` for the banner). On a
 * provider_unavailable failure they could disagree mid-flight, producing
 * "Retryable" badge + "not recoverable" headline + "Aborted" banner all
 * on the same screen. The state machine is now the only writer; this
 * file is the only reader.
 */

export type LiveStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'failed_retryable'
  | 'aborted'
  | 'cancelled'
  | 'completed';

/** Mirror of backend `CanonicalFailureMeta`. Tolerates partial shapes from
 *  older rows that pre-date the state machine. */
export interface CanonicalFailureMeta {
  classification?: string;
  status?: number | string;
  providerMessage?: string;
  model?: string;
  role?: string;
  endpoint?: string;
  upstream?: string;
  retryable?: boolean;
  terminal?: boolean;
  abortReason?:
    | 'budget_exhausted'
    | 'auth_error'
    | 'invalid_request'
    | 'non_recoverable_classification'
    | 'cancelled'
    | 'other';
  retryAttempts?: number;
  retryBudget?: number;
  attemptsRemaining?: number;
  resumeAvailable?: boolean;
  orchestratorHints?: string[];
}

/** Lightweight subset of `ResearchRun` the classifier needs. */
export interface RunStateInput {
  status?: string;
  failure_meta?: Record<string, unknown> | CanonicalFailureMeta;
  retry_attempts?: number | null;
  retry_budget?: number | null;
  progress_message?: string | null;
  progress_stage?: string | null;
}

/** Optional transient failure event piped in over websocket between polls. */
export interface TransientFailureContext {
  terminal?: boolean;
  retryable?: boolean;
  failureMeta?: Record<string, unknown> | CanonicalFailureMeta;
}

export const LIVE_STATUS_COPY: Record<
  LiveStatus,
  { label: string; tone: 'info' | 'good' | 'warn' | 'bad' | 'idle' }
> = {
  queued: {
    label: 'Queued — waiting for a research worker to pick this up.',
    tone: 'idle',
  },
  running: { label: 'Running — pipeline is active.', tone: 'info' },
  retrying: { label: 'Retrying after a previous failure.', tone: 'info' },
  failed_retryable: {
    label:
      'Failed — the run hit a recoverable error. Use Resume from last failure to retry from the saved state.',
    tone: 'warn',
  },
  aborted: {
    label:
      'Aborted — no more retries will run. Either the retry budget was exhausted or the failure was non-recoverable. Start a new run.',
    tone: 'bad',
  },
  cancelled: { label: 'Cancelled by user.', tone: 'idle' },
  completed: { label: 'Completed — report is being opened.', tone: 'good' },
};

function readMeta(meta: unknown): CanonicalFailureMeta {
  if (!meta || typeof meta !== 'object') return {};
  return meta as CanonicalFailureMeta;
}

/**
 * The canonical reader. Returns one `LiveStatus`. Every UI surface uses
 * this — there is no "compute it again my way" branch anywhere in the
 * page.
 */
export function deriveRunState(
  run: RunStateInput | null | undefined,
  transient?: TransientFailureContext | null
): LiveStatus {
  const runStatus = run?.status;
  const persistedMeta = readMeta(run?.failure_meta);
  const transientMeta = readMeta(transient?.failureMeta);

  // Terminal state wins everywhere. If either source says terminal, the run
  // is aborted — full stop, no Resume button, no Retryable badge.
  const terminalFlag = persistedMeta.terminal === true || transientMeta.terminal === true;
  const transientTerminal = transient?.terminal === true;
  if (terminalFlag || transientTerminal || runStatus === 'aborted') return 'aborted';

  if (runStatus === 'completed') return 'completed';
  if (runStatus === 'cancelled') return 'cancelled';

  if (runStatus === 'failed') {
    // A failed row is retryable only if the canonical meta says so. We
    // never infer retryability from a free-text message.
    const persistedRetryable =
      persistedMeta.retryable === true || persistedMeta.resumeAvailable === true;
    const transientRetryable =
      transient?.retryable === true ||
      transientMeta.retryable === true ||
      transientMeta.resumeAvailable === true;
    return persistedRetryable || transientRetryable ? 'failed_retryable' : 'aborted';
  }

  // Live (queued or running). Surface the retrying state when the row was
  // resumed at least once OR the latest progress message hints at retry.
  const attempts = Number(run?.retry_attempts ?? persistedMeta.retryAttempts ?? 0);
  const isRetryAttempt = Number.isFinite(attempts) && attempts > 0;
  const msg = `${run?.progress_message ?? ''} ${run?.progress_stage ?? ''}`.toLowerCase();
  const retryHinted = /\b(retry|retried|retrying|resum|retry queued)\b/.test(msg);

  if (runStatus === 'queued' && (isRetryAttempt || retryHinted)) return 'retrying';
  if (runStatus === 'running' && isRetryAttempt) return 'retrying';
  if (runStatus === 'running') return 'running';
  return 'queued';
}

/** True iff Resume button should be shown. */
export function isResumeAvailable(state: LiveStatus): boolean {
  return state === 'failed_retryable';
}

/** Map a state to the trace badge label + variant. */
export function badgeForState(state: LiveStatus): {
  text: string;
  variant: 'retryable' | 'resumed' | 'terminal' | 'active';
} | null {
  if (state === 'failed_retryable') return { text: 'Retryable', variant: 'retryable' };
  if (state === 'aborted') return { text: 'Aborted', variant: 'terminal' };
  if (state === 'retrying') return { text: 'Resumed', variant: 'resumed' };
  return null;
}

/**
 * Backward-compat shim. Older code paths (the failure card composition,
 * the page banner) used the simpler `classifyLiveStatus(runStatus, failure)`
 * shape. Now thin-wraps `deriveRunState`.
 */
export function classifyLiveStatus(
  runStatus: string | undefined,
  failure: TransientFailureContext | null,
  retryContext?: { retryAttempts?: number | null; progressMessage?: string | null; progressStage?: string | null }
): LiveStatus {
  return deriveRunState(
    {
      status: runStatus,
      failure_meta: failure?.failureMeta,
      retry_attempts: retryContext?.retryAttempts ?? null,
      progress_message: retryContext?.progressMessage ?? null,
      progress_stage: retryContext?.progressStage ?? null,
    },
    failure ?? undefined
  );
}

/**
 * Failure-card headline derivation — also state-driven, never message-driven.
 */
export function failureCardHeadline(state: LiveStatus): string | null {
  if (state === 'aborted') return 'Run aborted — no further retries will be attempted.';
  if (state === 'failed_retryable') return 'Run failed — recoverable. You can resume from the last failure.';
  return null;
}
