/**
 * Phase-duration accounting for a research run.
 *
 * A run's phase timings are kept as two parallel records: `starts` holds the
 * timestamp of each phase that is currently open, and `durations` holds the
 * accumulated wall-clock time of each phase that has been closed. A phase can
 * legitimately be re-entered (the orchestrator revisits stages during
 * rediscovery), so closing accumulates rather than assigns.
 *
 * The invariant that matters: closing a phase MUST clear its start marker.
 * `runResearchJobInner` closes the open phase from four different places
 * (before dossier statistics, before the run summary, on cancellation, on
 * failure) in addition to the ordinary `progress()` stage transition, and more
 * than one of those can run for the same phase in the same run. When the start
 * marker survives a close, the same window is billed again — run `0eee6032`
 * reported `epistemic_persistence` as 2m 22s against a true span of 71.081s,
 * exactly 2x, for precisely this reason.
 *
 * Every accumulation site goes through `closePhase` so the invariant is stated
 * once and cannot drift back apart.
 */

export type PhaseDurations = Record<string, number>;
export type PhaseStartTimes = Record<string, number>;

/**
 * Accumulate the elapsed time of `stage` into `durations` and mark it closed.
 *
 * No-op when the stage is falsy or not currently open, which makes repeated
 * closes idempotent. Returns the milliseconds billed by this call (0 when it
 * was a no-op) so callers can log or assert on it.
 */
export function closePhase(
  durations: PhaseDurations,
  starts: PhaseStartTimes,
  stage: string | null | undefined,
  now: number
): number {
  if (!stage) return 0;
  const start = starts[stage];
  if (start == null) return 0;
  const elapsed = Math.max(0, now - start);
  durations[stage] = (durations[stage] ?? 0) + elapsed;
  delete starts[stage];
  return elapsed;
}

/**
 * Mark `stage` as open at `now`, unless it is already open.
 *
 * Re-entering an already-open phase must not reset its start time: that would
 * discard the time already spent in it since the last close.
 */
export function openPhase(starts: PhaseStartTimes, stage: string, now: number): void {
  if (starts[stage] == null) {
    starts[stage] = now;
  }
}
