import { describe, expect, it } from 'vitest';
import { objectivesForTier, TIER_ALLOWED_OBJECTIVES } from './researchObjectives';

describe('researchObjectives tier gating', () => {
  it('exposes patent gap for pro tier', () => {
    const labels = objectivesForTier('pro').map((o) => o.value);
    expect(labels).toContain('PATENT_GAP_ANALYSIS');
    expect(labels.length).toBe(TIER_ALLOWED_OBJECTIVES.pro.length);
  });

  it('free_demo only gets general epistemic', () => {
    const labels = objectivesForTier('free_demo').map((o) => o.value);
    expect(labels).toEqual(['GENERAL_EPISTEMIC_RESEARCH']);
  });
});
