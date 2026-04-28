/**
 * Classifies a research run + failure event into a single live status the
 * UI banner reads from. Pulled out of `ResearchPageV2.tsx` so it can be
 * unit-tested — the previous version had an unreachable `'retrying'`
 * branch (PR #39 Copilot review) because the classifier never received
 * `retry_attempts` / progress hints.
 */

export type LiveStatus =
  | 'queued'
  | 'running'
  | 'retrying'
  | 'failed_retryable'
  | 'aborted'
  | 'cancelled'
  | 'completed';

export interface LiveStatusFailureContext {
  terminal?: boolean;
  retryable?: boolean;
}

export interface LiveStatusRetryContext {
  retryAttempts?: number | null;
  progressMessage?: string | null;
  progressStage?: string | null;
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

export function classifyLiveStatus(
  runStatus: string | undefined,
  failure: LiveStatusFailureContext | null,
  retryContext?: LiveStatusRetryContext
): LiveStatus {
  if (failure?.terminal || runStatus === 'aborted') return 'aborted';
  if (runStatus === 'completed') return 'completed';
  if (runStatus === 'cancelled') return 'cancelled';
  if (runStatus === 'failed') {
    return failure?.retryable === false ? 'aborted' : 'failed_retryable';
  }

  const attempts = Number(retryContext?.retryAttempts ?? 0);
  const isRetryAttempt = Number.isFinite(attempts) && attempts > 0;
  const msg = `${retryContext?.progressMessage ?? ''} ${retryContext?.progressStage ?? ''}`.toLowerCase();
  const retryHinted = /\b(retry|retried|retrying|resum|retry queued)\b/.test(msg);

  if (runStatus === 'queued' && (isRetryAttempt || retryHinted)) return 'retrying';
  if (runStatus === 'running' && isRetryAttempt) return 'retrying';
  if (runStatus === 'running') return 'running';
  return 'queued';
}
