/**
 * How a finished run is presented to a reader.
 *
 * Mirrors `backend/src/services/reasoning/runStatusDisplay.ts`. The rules live
 * in two places because the backend decides what a run's terminal state IS and
 * the frontend decides how it LOOKS, but they must agree on which outcomes are
 * trustworthy — otherwise the two drift and a failed run gets a green badge
 * again (PR #212).
 *
 * Before this existed, every surface answered "is this run OK?" independently:
 * `RunSummaryReport`, `ResearchRunRow`, `RunTelemetry` and `CostAnalytics` each
 * tested `status === 'completed'` in their own way, and the run summary was
 * handed a hardcoded `'completed'` regardless of the gate result.
 */

export type RunGateStatus =
  | 'completed'
  | 'completed_degraded'
  | 'contract_failed'
  | 'verification_failed'
  | 'no_evidence';

export type RunDisplayTone = 'success' | 'warning' | 'failure' | 'neutral';

export interface RunDisplayState {
  /** Raw status to key styling on, underscores intact. */
  status: string;
  /** Human-readable, e.g. `CONTRACT FAILED`. */
  label: string;
  tone: RunDisplayTone;
}

/** Tailwind classes per tone, so every surface renders a tone identically. */
export const RUN_TONE_CLASSES: Record<RunDisplayTone, { text: string; border: string; chip: string }> = {
  success: {
    text: 'text-green-400',
    border: 'border-green-800/30',
    chip: 'text-emerald-300 border-emerald-500/40 bg-emerald-500/10',
  },
  warning: {
    text: 'text-amber-400',
    border: 'border-amber-700/30',
    chip: 'text-amber-300 border-amber-500/40 bg-amber-500/10',
  },
  failure: {
    text: 'text-red-400',
    border: 'border-red-800/30',
    chip: 'text-rose-300 border-rose-500/40 bg-rose-500/10',
  },
  neutral: {
    text: 'text-slate-400',
    border: 'border-slate-700/30',
    chip: 'text-slate-300 border-slate-500/40 bg-slate-500/10',
  },
};

/**
 * Resolve what to display from the run status and the gate status.
 *
 * The gate status wins whenever present and not a clean pass — it is strictly
 * more specific than `failed`. A PASSING gate defers to the run status, so a run
 * that failed AFTER its gates (persistence, billing) is not painted green by a
 * stale gate result.
 */
export function resolveRunDisplayState(args: {
  status: string | null | undefined;
  gateStatus?: RunGateStatus | string | null;
}): RunDisplayState {
  const raw = (args.status ?? '').trim() || 'unknown';
  const gate = (args.gateStatus ?? null) as string | null;
  const status = gate && gate !== 'completed' ? gate : raw;
  const label = status.replace(/_/g, ' ').toUpperCase();

  if (status === 'completed') return { status, label, tone: 'success' };
  if (status === 'cancelled') return { status, label, tone: 'neutral' };
  if (
    status === 'aborted' ||
    status === 'failed' ||
    status === 'contract_failed' ||
    status === 'verification_failed' ||
    status === 'no_evidence'
  ) {
    return { status, label, tone: 'failure' };
  }
  // `completed_degraded`, in-flight statuses, and anything unrecognised: warn
  // rather than reassure. A status this module has not been taught must never
  // default to the colour a reader takes to mean "done and correct".
  return { status, label, tone: 'warning' };
}

/** True only for a clean pass. Degraded output is real work, but is not this. */
export function isCleanRunOutcome(args: {
  status: string | null | undefined;
  gateStatus?: RunGateStatus | string | null;
}): boolean {
  return resolveRunDisplayState(args).tone === 'success';
}
