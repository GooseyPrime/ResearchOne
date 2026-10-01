import { describe, expect, it } from 'vitest';
import {
  GOLDEN_PROMPT_SUITE,
  listGoldenPromptCases,
  missingGoldenPromptCoverage,
} from '../../services/planning/goldenPromptSuite';

describe('goldenPromptSuite', () => {
  it('contains one prompt per intent', () => {
    expect(missingGoldenPromptCoverage(GOLDEN_PROMPT_SUITE)).toEqual([]);
  });

  it('assigns unique stable case ids', () => {
    const ids = GOLDEN_PROMPT_SUITE.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by intent', () => {
    const comparativeCases = listGoldenPromptCases({ intent: 'comparative' });
    expect(comparativeCases).toHaveLength(1);
    expect(comparativeCases[0].id).toBe('comparative');
  });
});
