/**
 * Classifies a thrown research-job error into a socket event payload.
 *
 * The worker uses this to decide between `research:aborted` (the run hit
 * its retry budget — terminal) and `research:failed` (recoverable, the
 * Resume button will be active). The DB state is written by
 * `runResearchJob` *before* it throws; this helper just makes sure the
 * realtime socket event matches that DB state. Without it, a stale
 * `research:failed` could briefly show a "Resume" button on the UI for a
 * run that has already been marked `aborted` server-side, which is what
 * the PR #39 reviewers (Codex P1, Copilot) flagged.
 *
 * Pulled out of `backend/src/queue/workers.ts` so it can be unit-tested
 * without spinning up a BullMQ worker / Redis.
 */
export interface ResearchJobFailureLike {
  runId?: string;
  stage?: string;
  percent?: number;
  message?: string;
  retryable?: boolean;
  failureMeta?: Record<string, unknown>;
}

export interface ResearchFailureSocketDecision {
  event: 'research:failed' | 'research:aborted';
  payload: {
    runId: string;
    stage: string;
    percent: number;
    message: string;
    error: string | undefined;
    retryable: boolean;
    terminal: boolean;
    failureMeta: Record<string, unknown>;
  };
}

export function classifyResearchFailureForSocket(
  err: ResearchJobFailureLike,
  fallbackRunId: string
): ResearchFailureSocketDecision {
  const fmeta = err.failureMeta ?? {};
  const terminal = fmeta.terminal === true;
  const payload = {
    runId: err.runId ?? fallbackRunId,
    stage: terminal ? 'aborted' : err.stage ?? 'unknown',
    percent: err.percent ?? 0,
    message: err.message ?? 'Research run failed',
    error: err.message,
    retryable: !terminal && Boolean(err.retryable),
    terminal,
    failureMeta: fmeta,
  };
  return {
    event: terminal ? 'research:aborted' : 'research:failed',
    payload,
  };
}
