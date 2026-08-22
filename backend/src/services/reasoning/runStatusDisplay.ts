/**
 * How a finished run should be described to a reader.
 *
 * The bug this exists to prevent: the orchestrator's success path built its run
 * summary with a hardcoded `status: 'completed'`. A run whose gate status was
 * `contract_failed` was correctly written to `research_runs` as `failed` — and
 * then pushed a green "COMPLETED" summary to the live view. The database and
 * the screen disagreed, and the user believed the screen.
 *
 * Status alone is not enough to render honestly: `mapGateStatusToRunStatus`
 * collapses every non-success into `failed`, which cannot distinguish an
 * incomplete deliverable from an unverifiable one from a crash. So the summary
 * carries the gate status too, and this module is the single place that decides
 * what the two together mean.
 */
import type { ReportGateStatus } from './reportGateStatus';

export type RunDisplayTone = 'success' | 'warning' | 'failure' | 'neutral';

export interface RunDisplayState {
  /** Value to show, underscores intact. */
  status: string;
  tone: RunDisplayTone;
}

/**
 * Resolve what to display from the run status and the gate status.
 *
 * The gate status wins whenever it is present and not a clean pass, because it
 * is strictly more specific. `completed` gate status defers to the run status
 * so a run that failed AFTER its gates (persistence, billing) is not painted
 * green by a stale gate result.
 */
export function resolveRunDisplayState(args: {
  status: string;
  gateStatus?: ReportGateStatus | null;
}): RunDisplayState {
  const gate = args.gateStatus ?? null;
  const status = gate && gate !== 'completed' ? gate : args.status;

  if (status === 'completed') return { status, tone: 'success' };
  if (status === 'cancelled') return { status, tone: 'neutral' };
  if (
    status === 'aborted' ||
    status === 'failed' ||
    status === 'contract_failed' ||
    status === 'verification_failed' ||
    status === 'no_evidence'
  ) {
    return { status, tone: 'failure' };
  }
  // completed_degraded, and anything unrecognised: warn rather than reassure.
  return { status, tone: 'warning' };
}

/**
 * True when the run may be presented as a finished, trustworthy deliverable.
 *
 * Deliberately narrow: only a clean pass qualifies. Degraded output is real
 * work and is still shown, but it must not wear the colour a reader takes to
 * mean "this is done and correct".
 */
export function isCleanRunOutcome(args: {
  status: string;
  gateStatus?: ReportGateStatus | null;
}): boolean {
  return resolveRunDisplayState(args).tone === 'success';
}

/** Plain-language reason a gated run did not complete. */
export function describeGateFailure(status: ReportGateStatus): string {
  switch (status) {
    case 'contract_failed':
      return 'The report did not deliver everything the request asked for. It has been kept for review rather than finalised.';
    case 'verification_failed':
      return 'The report did not pass verification. It has been kept for review rather than finalised.';
    case 'completed_degraded':
      return 'The report was produced from fewer sources than this request requires, so it is marked degraded rather than finalised.';
    case 'no_evidence':
      return 'No citable evidence cleared the corpus gate for this run. The run stopped before synthesis.';
    default:
      return 'The report did not pass its quality gates.';
  }
}

export interface RunTerminalOutcome {
  /** Value written to `research_runs.status`. */
  runStatus: 'completed' | 'failed';
  /** Gate that produced it, carried through to the summary and the job result. */
  gateStatus: ReportGateStatus;
  /** False when a gate failed; the report exists but is under review. */
  completedCleanly: boolean;
  failedStage: string | null;
  errorMessage: string | null;
}

/**
 * Single source of truth for what a finished run's terminal state is.
 *
 * This exists because the regression test for the original bug did not actually
 * exercise the code that had the bug: it fed an already-correct state to a
 * helper production did not call, so reverting the orchestrator's hardcoded
 * `status: 'completed'` left every test green (Codex P2 review, PR #212).
 *
 * The orchestrator now derives its run row, its summary, and its job result
 * from this one function, so a test of this function is a test of all three.
 */
export function resolveRunTerminalOutcome(gateStatus: ReportGateStatus): RunTerminalOutcome {
  const runStatus = gateStatus === 'completed' ? 'completed' : 'failed';
  const completedCleanly = gateStatus === 'completed';
  return {
    runStatus,
    gateStatus,
    completedCleanly,
    failedStage: completedCleanly ? null : 'verification',
    errorMessage: completedCleanly ? null : describeGateFailure(gateStatus),
  };
}
