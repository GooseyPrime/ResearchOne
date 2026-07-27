import { describe, expect, it } from 'vitest';
import {
  GOLDEN_PROMPT_DEPTHS,
  GOLDEN_PROMPT_SUITE,
  listGoldenPromptCases,
  missingGoldenPromptCoverage,
} from '../../services/planning/goldenPromptSuite';

describe('goldenPromptSuite', () => {
  it('contains one prompt per intent × depth combination', () => {
    const missing = missingGoldenPromptCoverage(GOLDEN_PROMPT_SUITE);
    expect(missing).toEqual([]);
  });

  it('assigns unique stable case ids', () => {
    const ids = GOLDEN_PROMPT_SUITE.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('filters by intent and depth', () => {
    const comparativeCases = listGoldenPromptCases({ intent: 'comparative' });
    expect(comparativeCases).toHaveLength(GOLDEN_PROMPT_DEPTHS.length);
    const deepOnly = listGoldenPromptCases({ intent: 'comparative', depth: 'deep' });
    expect(deepOnly).toHaveLength(1);
    expect(deepOnly[0].id).toBe('comparative:deep');
  });
});
