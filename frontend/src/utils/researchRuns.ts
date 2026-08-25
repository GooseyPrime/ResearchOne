import { getAdaptiveRefetchIntervalMs } from './apiRateLimit';

/** Statuses that need live polling / global active-run chrome. */
export const IN_FLIGHT_RUN_STATUSES = [
  'running',
  'queued',
  'plan_pending_confirmation',
] as const;

export type InFlightRunStatus = (typeof IN_FLIGHT_RUN_STATUSES)[number];

export function isInFlightRunStatus(status: string): status is InFlightRunStatus {
  return (IN_FLIGHT_RUN_STATUSES as readonly string[]).includes(status);
}

export function hasInFlightResearchRuns(
  runs: Array<{ status: string }> | undefined
): boolean {
  return (runs ?? []).some((r) => isInFlightRunStatus(r.status));
}

/**
 * Refetch cadence for the shared `['research-runs']` query.
 *
 * React Query takes the SHORTEST interval across every observer of a key, so
 * one observer with an unconditional interval silently overrides every other
 * observer's idle backoff. `Layout` and `ActiveRunBadge` both watch this key;
 * when the badge polled unconditionally, every mounted Layout kept requesting
 * the run list every eight seconds forever, whether or not anything was
 * running (Codex, #227).
 *
 * One definition, so a second observer cannot disagree with the first about
 * when idle means idle.
 */
export function researchRunsPollIntervalMs(
  runs: Array<{ status: string }> | undefined,
  activeMs: number
): number | false {
  return hasInFlightResearchRuns(runs) ? getAdaptiveRefetchIntervalMs(activeMs) : false;
}
