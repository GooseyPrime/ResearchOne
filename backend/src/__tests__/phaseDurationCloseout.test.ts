import { describe, expect, it } from 'vitest';
import {
  closePhase,
  openPhase,
  type PhaseDurations,
  type PhaseStartTimes,
} from '../services/reasoning/phaseTiming';

/**
 * Regression cover for the phase-duration double-billing that made run
 * `0eee6032` report `epistemic_persistence` as 2m 22s against a true span of
 * 71.081s — exactly 2x.
 *
 * `runResearchJobInner` closes the open phase from four places (before dossier
 * statistics, before the run summary, on cancellation, on failure) on top of
 * the ordinary `progress()` stage transition. More than one of those runs for
 * the same phase in a normal completing run, and the closeouts used to
 * accumulate without clearing the start marker — so the same window was billed
 * twice.
 */
describe('phaseTiming', () => {
  const STAGE = 'epistemic_persistence';
  const START = 1_000_000;
  const SPAN = 71_081;

  const fresh = (): { durations: PhaseDurations; starts: PhaseStartTimes } => ({
    durations: {},
    starts: {},
  });

  it('bills an open phase exactly once across every closeout path', () => {
    const { durations, starts } = fresh();
    openPhase(starts, STAGE, START);

    // closeout A (pre-dossier-statistics), the `done` transition, closeout B.
    closePhase(durations, starts, STAGE, START + SPAN);
    closePhase(durations, starts, STAGE, START + SPAN);
    closePhase(durations, starts, STAGE, START + SPAN);

    expect(durations[STAGE]).toBe(SPAN);
    expect(durations[STAGE]).not.toBe(142_162); // the 2m 22s that shipped
  });

  it('clears the start marker so a later close is a no-op', () => {
    const { durations, starts } = fresh();
    openPhase(starts, STAGE, START);

    expect(closePhase(durations, starts, STAGE, START + SPAN)).toBe(SPAN);
    expect(starts[STAGE]).toBeUndefined();
    expect(closePhase(durations, starts, STAGE, START + 999_999)).toBe(0);
    expect(durations[STAGE]).toBe(SPAN);
  });

  it('accumulates across genuine re-entries of the same phase', () => {
    const { durations, starts } = fresh();

    openPhase(starts, STAGE, 0);
    closePhase(durations, starts, STAGE, 500);
    openPhase(starts, STAGE, 900);
    closePhase(durations, starts, STAGE, 1_100);

    expect(durations[STAGE]).toBe(700); // 500 + 200, not the 1_100 wall span
  });

  it('does not reset an already-open phase', () => {
    const { durations, starts } = fresh();

    openPhase(starts, STAGE, 100);
    openPhase(starts, STAGE, 400); // re-entry without an intervening close
    closePhase(durations, starts, STAGE, 600);

    expect(durations[STAGE]).toBe(500); // from 100, not from 400
  });

  it('ignores a falsy or never-opened stage', () => {
    const { durations, starts } = fresh();

    expect(closePhase(durations, starts, null, 1_000)).toBe(0);
    expect(closePhase(durations, starts, '', 1_000)).toBe(0);
    expect(closePhase(durations, starts, 'never_ran', 1_000)).toBe(0);
    expect(durations).toEqual({});
  });

  it('never bills negative time when the clock moves backwards', () => {
    const { durations, starts } = fresh();

    openPhase(starts, STAGE, 1_000);
    closePhase(durations, starts, STAGE, 400);

    expect(durations[STAGE]).toBe(0);
  });
});
