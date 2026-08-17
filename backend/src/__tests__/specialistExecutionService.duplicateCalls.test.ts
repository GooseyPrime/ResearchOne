import { beforeEach, describe, expect, it, vi } from 'vitest';

const callRoleModelMock = vi.fn();

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
  SYSTEM_PROMPTS: {
    market_scout: 'market',
    competitor_mapper: 'competitor',
  },
}));

describe('specialistExecutionService duplicate execution guard', () => {
  beforeEach(() => {
    callRoleModelMock.mockReset();
  });

  it('runs each specialist at most once per attempt even when duplicated in the same group', async () => {
    callRoleModelMock
      .mockResolvedValueOnce({
        content: JSON.stringify({
          opportunities: [],
          summary: 'ok',
          confidence: 'medium',
        }),
      })
      .mockResolvedValueOnce({
        content: JSON.stringify({
          competitors: [],
          gap_summary: 'ok',
          confidence: 'medium',
        }),
      });

    const { runSpecialistExecution } = await import('../services/reasoning/specialistExecutionService');
    const result = await runSpecialistExecution({
      runId: 'run-1',
      query: 'query',
      plan: {},
      sourceContext: 'evidence',
      executionPlan: {
        version: 1,
        intent: 'opportunity_discovery',
        corePipelineStages: [],
        coreAgentRoles: [],
        specialistAgents: ['market_scout', 'competitor_mapper'],
        sourceClasses: [],
        executionGroups: [
          ['market_scout', 'competitor_mapper', 'market_scout'],
        ],
        dependsOn: {},
        skipReasons: {},
        expectedOutputTemplateId: 'intent_opportunity_discovery',
      },
      allowFallbackByRole: {},
    });

    expect(result.ran.sort()).toEqual(['competitor_mapper', 'market_scout']);
    expect(callRoleModelMock).toHaveBeenCalledTimes(2);
  });
});
