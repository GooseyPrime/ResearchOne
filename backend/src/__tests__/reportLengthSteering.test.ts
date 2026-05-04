import { describe, it, expect } from 'vitest';
import {
  clampWordTarget,
  distributeWordBudget,
  REPORT_WORD_COUNT_MIN,
  REPORT_WORD_COUNT_MAX,
  REPORT_WORD_COUNT_DEFAULT,
  REPORT_WORD_COUNT_PER_SECTION_FLOOR,
} from '../services/reasoning/reportGenerator';

const SECTION_COUNT = 10;

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

  it('REPORT_WORD_COUNT_MIN equals SECTION_COUNT × per-section floor', () => {
    // This is the contract that prevents distributeWordBudget from
    // overshooting at the floor: the minimum budget is exactly the sum of
    // per-section floors, so each section can sit at the floor and the
    // total still equals what the user requested.
    expect(REPORT_WORD_COUNT_MIN).toBe(SECTION_COUNT * REPORT_WORD_COUNT_PER_SECTION_FLOOR);
  });
});

describe('distributeWordBudget', () => {
  function sum(budgets: Map<string, number>): number {
    let total = 0;
    for (const v of budgets.values()) total += v;
    return total;
  }

  it('returns one entry per section in SECTION_PLAN', () => {
    const budgets = distributeWordBudget(2200);
    expect(budgets.size).toBe(SECTION_COUNT);
  });

  it('every section receives at least the per-section floor', () => {
    for (const total of [REPORT_WORD_COUNT_MIN, 1200, 2200, 4000, 7000, REPORT_WORD_COUNT_MAX]) {
      const budgets = distributeWordBudget(total);
      for (const v of budgets.values()) {
        expect(v).toBeGreaterThanOrEqual(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
      }
    }
  });

  it('summed budgets stay close to the requested total at the floor', () => {
    // At exactly REPORT_WORD_COUNT_MIN (every section pinned to floor) the
    // sum must equal the total — no overshoot. This is the regression Codex
    // and Copilot flagged on PR #50.
    const total = REPORT_WORD_COUNT_MIN;
    const budgets = distributeWordBudget(total);
    expect(sum(budgets)).toBe(total);
  });

  it('summed budgets track the requested total within rounding for typical presets', () => {
    for (const total of [1200, 2200, 4000, 7000, 12000]) {
      const budgets = distributeWordBudget(total);
      const s = sum(budgets);
      // ≤ SECTION_COUNT words of slack per section from Math.round.
      expect(Math.abs(s - total)).toBeLessThanOrEqual(SECTION_COUNT);
    }
  });

  it('sections with higher weight get larger budgets', () => {
    const budgets = distributeWordBudget(4000);
    // Per the SECTION_PLAN weights, Reasoning (1.6) and Evidence (1.4)
    // should outweigh Executive Summary (0.6) and Recommended Queries (0.5).
    const reasoning = budgets.get('reasoning_analysis')!;
    const evidence = budgets.get('evidence_ledger')!;
    const exec = budgets.get('executive_summary')!;
    const recommend = budgets.get('recommended_next_queries')!;
    expect(reasoning).toBeGreaterThan(exec);
    expect(reasoning).toBeGreaterThan(recommend);
    expect(evidence).toBeGreaterThan(exec);
  });
});
