import { describe, it, expect } from 'vitest';
import {
  clampWordTarget,
  distributeWordBudget,
  REPORT_WORD_COUNT_MIN,
  REPORT_WORD_COUNT_MAX,
  REPORT_WORD_COUNT_DEFAULT,
  REPORT_WORD_COUNT_PER_SECTION_FLOOR,
} from '../services/reasoning/reportGenerator';
import { draftedSections } from '../services/reasoning/baselineReport';

/** The plan every report is written to. */
const READER_PLAN = draftedSections('adjudication', 'q');
const SECTION_COUNT = READER_PLAN.length;
/** The minimum length is ten per-section floors, the size the request form's length choices were built around. */
const MIN_LENGTH_FLOORS = 10;

describe('clampWordTarget', () => {
  it('returns the default when input is undefined', () => {
    expect(clampWordTarget(undefined)).toBe(REPORT_WORD_COUNT_DEFAULT);
  });

  it('returns the default when input is NaN, Infinity, or non-positive', () => {
    expect(clampWordTarget(NaN)).toBe(REPORT_WORD_COUNT_DEFAULT);
    expect(clampWordTarget(Number.POSITIVE_INFINITY)).toBe(REPORT_WORD_COUNT_DEFAULT);
    expect(clampWordTarget(0)).toBe(REPORT_WORD_COUNT_DEFAULT);
    expect(clampWordTarget(-1234)).toBe(REPORT_WORD_COUNT_DEFAULT);
  });

  it('clamps below-floor inputs up to REPORT_WORD_COUNT_MIN', () => {
    expect(clampWordTarget(50)).toBe(REPORT_WORD_COUNT_MIN);
    expect(clampWordTarget(REPORT_WORD_COUNT_MIN - 1)).toBe(REPORT_WORD_COUNT_MIN);
  });

  it('clamps above-ceiling inputs down to REPORT_WORD_COUNT_MAX', () => {
    expect(clampWordTarget(50000)).toBe(REPORT_WORD_COUNT_MAX);
    expect(clampWordTarget(REPORT_WORD_COUNT_MAX + 1)).toBe(REPORT_WORD_COUNT_MAX);
  });

  it('passes in-range values through and rounds to the nearest integer', () => {
    expect(clampWordTarget(2200)).toBe(2200);
    expect(clampWordTarget(2200.4)).toBe(2200);
    expect(clampWordTarget(2200.6)).toBe(2201);
  });

  it('REPORT_WORD_COUNT_MIN is ten per-section floors and covers the reader plan', () => {
    // The minimum must be at least the sum of the reader plan's per-section
    // floors, so the smallest length a user can choose never forces
    // distributeWordBudget above the requested total.
    expect(REPORT_WORD_COUNT_MIN).toBe(MIN_LENGTH_FLOORS * REPORT_WORD_COUNT_PER_SECTION_FLOOR);
    expect(REPORT_WORD_COUNT_MIN).toBeGreaterThanOrEqual(SECTION_COUNT * REPORT_WORD_COUNT_PER_SECTION_FLOOR);
  });
});

describe('distributeWordBudget', () => {
  function sum(budgets: Map<string, number>): number {
    let total = 0;
    for (const v of budgets.values()) total += v;
    return total;
  }

  it('returns one entry per section of the reader plan', () => {
    const budgets = distributeWordBudget(2200, READER_PLAN);
    expect(budgets.size).toBe(SECTION_COUNT);
  });

  it('every section receives at least the per-section floor', () => {
    for (const total of [REPORT_WORD_COUNT_MIN, 1200, 2200, 4000, 7000, REPORT_WORD_COUNT_MAX]) {
      const budgets = distributeWordBudget(total, READER_PLAN);
      for (const v of budgets.values()) {
        expect(v).toBeGreaterThanOrEqual(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
      }
    }
  });

  it('summed budgets equal the requested total when every section sits at the floor', () => {
    // When the total is exactly the sum of per-section floors, every section
    // is pinned to the floor and the sum equals the total — no overshoot.
    // This is the regression Codex and Copilot flagged on PR #50.
    const total = SECTION_COUNT * REPORT_WORD_COUNT_PER_SECTION_FLOOR;
    const budgets = distributeWordBudget(total, READER_PLAN);
    expect(sum(budgets)).toBe(total);
    for (const v of budgets.values()) expect(v).toBe(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
  });

  it('does not overshoot the minimum length a user can choose', () => {
    const budgets = distributeWordBudget(REPORT_WORD_COUNT_MIN, READER_PLAN);
    expect(sum(budgets)).toBeLessThanOrEqual(REPORT_WORD_COUNT_MIN);
    expect(REPORT_WORD_COUNT_MIN - sum(budgets)).toBeLessThanOrEqual(SECTION_COUNT);
  });

  it('summed budgets track the requested total within rounding for typical presets', () => {
    for (const total of [1200, 2200, 4000, 7000, 12000]) {
      const budgets = distributeWordBudget(total, READER_PLAN);
      const s = sum(budgets);
      // ≤ SECTION_COUNT words of slack per section from Math.round.
      expect(Math.abs(s - total)).toBeLessThanOrEqual(SECTION_COUNT);
    }
  });

  it('sections with higher weight get larger budgets', () => {
    // The reader plan weights its sections equally; an extra section added
    // for a requested format can carry more weight and must get more words.
    const plan = [
      ...READER_PLAN,
      { key: 'comparison_table', title: 'Comparison table', weight: 1.6 },
      { key: 'steps', title: 'Steps', weight: 0.5 },
    ];
    const budgets = distributeWordBudget(4000, plan);
    const heavy = budgets.get('comparison_table')!;
    const summary = budgets.get('summary')!;
    const light = budgets.get('steps')!;
    expect(heavy).toBeGreaterThan(summary);
    expect(summary).toBeGreaterThan(light);
  });

  it('gives the equally weighted reader sections equal budgets', () => {
    const budgets = distributeWordBudget(4000, READER_PLAN);
    expect(new Set(budgets.values()).size).toBe(1);
  });
});
