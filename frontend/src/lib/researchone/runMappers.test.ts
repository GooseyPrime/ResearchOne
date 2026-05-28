import { describe, expect, it } from 'vitest';
import { pipelineStages } from '@/content/researchoneUiData';
import { mapApiRunStage } from './runMappers';

describe('mapApiRunStage', () => {
  it('maps backend stage names to pipeline stage ids', () => {
    for (const [apiStage, expectedId] of [
      ['sleuth', 'sleuth'],
      ['quantitative', 'quantitative'],
      ['formatter', 'formatter'],
      ['retriever_assessor', 'retriever'],
      ['plan_pending_confirmation', 'planner'],
    ] as const) {
      const mapped = mapApiRunStage(apiStage);
      expect(pipelineStages.findIndex((s) => s.id === mapped)).toBeGreaterThanOrEqual(0);
      expect(mapped).toBe(expectedId);
    }
  });
});
