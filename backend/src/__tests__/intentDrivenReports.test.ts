import { describe, it, expect } from 'vitest';
import {
  ADJUDICATIVE_SECTION_INTENTS,
  DESCRIPTIVE_SECTION_PLAN,
  distributeWordBudget,
  REPORT_WORD_COUNT_PER_SECTION_FLOOR,
  REPORT_WORD_COUNT_MIN,
} from '../services/reasoning/reportGenerator';

// ─────────────────────────────────────────────────────────────────────────────
// ADJUDICATIVE_SECTION_INTENTS membership
// ─────────────────────────────────────────────────────────────────────────────

describe('ADJUDICATIVE_SECTION_INTENTS', () => {
  it('contains adjudication', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('adjudication')).toBe(true);
  });

  it('contains investigation', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('investigation')).toBe(true);
  });

  it('contains story_verification', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('story_verification')).toBe(true);
  });

  it('does NOT contain opportunity_discovery', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('opportunity_discovery')).toBe(false);
  });

  it('does NOT contain feasibility', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('feasibility')).toBe(false);
  });

  it('does NOT contain implementation', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('implementation')).toBe(false);
  });

  it('does NOT contain factual_report', () => {
    expect(ADJUDICATIVE_SECTION_INTENTS.has('factual_report')).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DESCRIPTIVE_SECTION_PLAN shape
// ─────────────────────────────────────────────────────────────────────────────

describe('DESCRIPTIVE_SECTION_PLAN', () => {
  it('does not contain falsification_criteria', () => {
    expect(DESCRIPTIVE_SECTION_PLAN.some((s) => s.key === 'falsification_criteria')).toBe(false);
  });

  it('does not contain contradiction_analysis', () => {
    expect(DESCRIPTIVE_SECTION_PLAN.some((s) => s.key === 'contradiction_analysis')).toBe(false);
  });

  it('has 6 sections', () => {
    expect(DESCRIPTIVE_SECTION_PLAN).toHaveLength(6);
  });

  it('includes executive_summary, evidence_ledger, reasoning_analysis, and synthesis_conclusions', () => {
    const keys = DESCRIPTIVE_SECTION_PLAN.map((s) => s.key);
    expect(keys).toContain('executive_summary');
    expect(keys).toContain('evidence_ledger');
    expect(keys).toContain('reasoning_analysis');
    expect(keys).toContain('synthesis_conclusions');
  });

  it('every section has a positive weight', () => {
    for (const sec of DESCRIPTIVE_SECTION_PLAN) {
      expect(sec.weight).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// distributeWordBudget with DESCRIPTIVE_SECTION_PLAN
// ─────────────────────────────────────────────────────────────────────────────

describe('distributeWordBudget with DESCRIPTIVE_SECTION_PLAN', () => {
  function sum(budgets: Map<string, number>): number {
    let total = 0;
    for (const v of budgets.values()) total += v;
    return total;
  }

  it('returns one entry per descriptive section', () => {
    const budgets = distributeWordBudget(REPORT_WORD_COUNT_MIN, DESCRIPTIVE_SECTION_PLAN);
    expect(budgets.size).toBe(DESCRIPTIVE_SECTION_PLAN.length);
  });

  it('every section receives at least the per-section floor', () => {
    for (const total of [480, REPORT_WORD_COUNT_MIN, 2200, 4000, 12000]) {
      const budgets = distributeWordBudget(total, DESCRIPTIVE_SECTION_PLAN);
      for (const v of budgets.values()) {
        expect(v).toBeGreaterThanOrEqual(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
      }
    }
  });

  it('summed budgets track the requested total within rounding', () => {
    for (const total of [2200, 4000, 7000, 12000]) {
      const budgets = distributeWordBudget(total, DESCRIPTIVE_SECTION_PLAN);
      const s = sum(budgets);
      expect(Math.abs(s - total)).toBeLessThanOrEqual(DESCRIPTIVE_SECTION_PLAN.length);
    }
  });

  it('higher-weight sections get larger budgets at representative totals', () => {
    const budgets = distributeWordBudget(4000, DESCRIPTIVE_SECTION_PLAN);
    const reasoning = budgets.get('reasoning_analysis')!;
    const evidence = budgets.get('evidence_ledger')!;
    const exec = budgets.get('executive_summary')!;
    expect(reasoning).toBeGreaterThan(exec);
    expect(evidence).toBeGreaterThan(exec);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT_WORD_COUNT_MIN remains tied to the adjudicative 10-section plan
// (backward compat for legacy / undefined intent runs)
// ─────────────────────────────────────────────────────────────────────────────

describe('REPORT_WORD_COUNT_MIN backward compatibility', () => {
  it('equals 10 × per-section floor (adjudicative plan, unchanged)', () => {
    expect(REPORT_WORD_COUNT_MIN).toBe(10 * REPORT_WORD_COUNT_PER_SECTION_FLOOR);
  });
});
