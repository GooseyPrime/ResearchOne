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
