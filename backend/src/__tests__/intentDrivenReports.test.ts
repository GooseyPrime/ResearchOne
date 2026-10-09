import { describe, it, expect } from 'vitest';
import {
  ADJUDICATIVE_SECTION_INTENTS,
  distributeWordBudget,
  REPORT_WORD_COUNT_PER_SECTION_FLOOR,
  REPORT_WORD_COUNT_MIN,
} from '../services/reasoning/reportGenerator';
import { draftedSections } from '../services/reasoning/baselineReport';

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
// The reader plan is the one plan for every report type
// ─────────────────────────────────────────────────────────────────────────────

const EVERY_INTENT = [
  'adjudication',
  'investigation',
  'story_verification',
  'opportunity_discovery',
  'feasibility',
  'implementation',
  'factual_report',
  undefined,
] as const;

describe('the reader plan every report is written to', () => {
  it('is the same plan for adjudicative and descriptive report types', () => {
    const base = draftedSections('factual_report', 'q');
    for (const intentId of EVERY_INTENT) {
      expect(draftedSections(intentId, 'q')).toEqual(base);
    }
  });

  it('does not contain falsification_criteria for any report type', () => {
    for (const intentId of EVERY_INTENT) {
      expect(draftedSections(intentId, 'q').some((s) => s.key === 'falsification_criteria')).toBe(false);
    }
  });

  it('does not contain contradiction_analysis for any report type', () => {
    for (const intentId of EVERY_INTENT) {
      expect(draftedSections(intentId, 'q').some((s) => s.key === 'contradiction_analysis')).toBe(false);
    }
  });

  it('has no evidence ledger, reasoning analysis or unresolved-questions section', () => {
    for (const intentId of EVERY_INTENT) {
      const plan = draftedSections(intentId, 'q');
      const keys = plan.map((s) => s.key);
      expect(keys).not.toContain('evidence_ledger');
      expect(keys).not.toContain('reasoning_analysis');
      expect(keys).not.toContain('synthesis_conclusions');
      expect(keys).not.toContain('unresolved_questions');
      expect(plan.map((s) => s.title).join(' | ')).not.toMatch(/falsif|contradiction|evidence ledger|unresolved|verdict/i);
    }
  });

  it('is Summary, Key findings, subject sections, Where sources disagree, Limits of this report', () => {
    const plan = draftedSections('adjudication', 'q');
    const subjects = plan.filter((s) => s.key.startsWith('topic_'));
    expect(subjects.length).toBeGreaterThan(0);
    expect(plan.map((s) => s.key)).toEqual([
      'summary',
      'key_findings',
      ...subjects.map((s) => s.key),
      'disagreement',
      'limits',
    ]);
    expect(plan.filter((s) => !s.key.startsWith('topic_')).map((s) => s.title)).toEqual([
      'Summary',
      'Key findings',
      'Where sources disagree',
      'Limits of this report',
    ]);
  });

  it('every section has a positive weight', () => {
    for (const sec of draftedSections('adjudication', 'q')) {
      expect(sec.weight).toBeGreaterThan(0);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// distributeWordBudget over the reader plan
// ─────────────────────────────────────────────────────────────────────────────

describe('distributeWordBudget over the reader plan', () => {
  const READER_PLAN = draftedSections('adjudication', 'q');

  function sum(budgets: Map<string, number>): number {
    let total = 0;
    for (const v of budgets.values()) total += v;
    return total;
  }

  it('returns one entry per reader section', () => {
    const budgets = distributeWordBudget(REPORT_WORD_COUNT_MIN, READER_PLAN);
    expect(budgets.size).toBe(READER_PLAN.length);
    expect([...budgets.keys()]).toEqual(READER_PLAN.map((s) => s.key));
  });

  it('every section receives at least the per-section floor', () => {
    for (const total of [480, REPORT_WORD_COUNT_MIN, 2200, 4000, 12000]) {
      const budgets = distributeWordBudget(total, READER_PLAN);
      for (const v of budgets.values()) {
        expect(v).toBeGreaterThanOrEqual(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
      }
    }
  });

  it('summed budgets track the requested total within rounding', () => {
    for (const total of [REPORT_WORD_COUNT_MIN, 2200, 4000, 7000, 12000]) {
      const budgets = distributeWordBudget(total, READER_PLAN);
      const s = sum(budgets);
      expect(Math.abs(s - total)).toBeLessThanOrEqual(READER_PLAN.length);
    }
  });

  it('higher-weight sections get larger budgets at representative totals', () => {
    // The reader plan weights its sections equally, so the weighting rule is
    // shown on a plan that carries a heavier extra section beside it.
    const weighted = [...READER_PLAN, { key: 'comparison_table', title: 'Comparison table', weight: 2 }];
    const budgets = distributeWordBudget(4000, weighted);
    const heavy = budgets.get('comparison_table')!;
    for (const section of READER_PLAN) {
      expect(heavy).toBeGreaterThan(budgets.get(section.key)!);
    }
    const even = distributeWordBudget(4000, READER_PLAN);
    expect(new Set(even.values()).size).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT_WORD_COUNT_MIN stays at ten per-section floors, the size the length
// choices on the request form were built around.
// ─────────────────────────────────────────────────────────────────────────────

describe('REPORT_WORD_COUNT_MIN', () => {
  it('equals 10 × per-section floor', () => {
    expect(REPORT_WORD_COUNT_MIN).toBe(10 * REPORT_WORD_COUNT_PER_SECTION_FLOOR);
    expect(REPORT_WORD_COUNT_MIN).toBe(800);
  });

  it('leaves every reader section above the floor at the minimum length', () => {
    const plan = draftedSections('factual_report', 'q');
    for (const v of distributeWordBudget(REPORT_WORD_COUNT_MIN, plan).values()) {
      expect(v).toBeGreaterThanOrEqual(REPORT_WORD_COUNT_PER_SECTION_FLOOR);
    }
  });
});
