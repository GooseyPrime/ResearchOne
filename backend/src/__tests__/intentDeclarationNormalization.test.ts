import { beforeEach, describe, expect, it, vi } from 'vitest';

const { callRoleModelMock } = vi.hoisted(() => ({
  callRoleModelMock: vi.fn(),
}));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: callRoleModelMock,
}));

import { classifyIntent } from '../services/planning/intentClassifier';

const CLASSIFIER_OPTS = {
  allowFallbackByRole: {},
  byokApiKeyOverride: 'test-openrouter-key',
} as const;

describe('intent declaration normalization', () => {
  beforeEach(() => {
    callRoleModelMock.mockReset();
    callRoleModelMock.mockResolvedValue({
      content: JSON.stringify({
        primaryIntent: 'comparative',
        confidence: 0.61,
        reasoning: 'fallback comparative classification from lexical/LLM path',
      }),
    });
  });

  const cases = [
    ['bare', 'Primary research intent: opportunity_discovery', 'opportunity_discovery'],
    ['bold', 'Primary research intent: **opportunity_discovery**', 'opportunity_discovery'],
    ['italic', 'Primary research intent: *opportunity_discovery*', 'opportunity_discovery'],
    ['double underscore', 'Primary research intent: __opportunity_discovery__', 'opportunity_discovery'],
    ['backticks', 'Primary research intent: `opportunity_discovery`', 'opportunity_discovery'],
    ['double quotes', 'Primary research intent: "opportunity_discovery"', 'opportunity_discovery'],
    ['single quotes', "Primary research intent: 'opportunity_discovery'", 'opportunity_discovery'],
    ['trailing punctuation', 'Primary research intent: opportunity_discovery.', 'opportunity_discovery'],
    ['value on next line', 'Primary research intent:\n\n**opportunity_discovery**', 'opportunity_discovery'],
  ] as const;

  for (const [label, query, expected] of cases) {
    it(`resolves ${label} declarations before lexical or LLM fallback`, async () => {
      const brief = await classifyIntent(query, undefined, CLASSIFIER_OPTS);

      expect(brief.primaryIntent).toBe(expected);
      expect(brief.confidence).toBeGreaterThanOrEqual(0.95);
      expect(brief.reasoning).toContain('Explicit');
    });
  }

  it('resolves the reference prompt to opportunity_discovery and captures secondary feasibility intent', async () => {
    const prompt = [
      'Do not reinterpret this request as a general factual report.',
      'Primary research intent:',
      '',
      '**opportunity_discovery**',
      'Secondary research intent: **feasibility**',
      '',
      'Compare 20 affiliate comparison-site opportunities and rank them by income potential.',
      'Do not end with vague advice such as "do more research."',
    ].join('\n');

    const brief = await classifyIntent(prompt, undefined, CLASSIFIER_OPTS);

    expect(brief.primaryIntent).toBe('opportunity_discovery');
    expect(brief.secondaryIntent).toBe('feasibility');
    expect(brief.confidence).toBeGreaterThanOrEqual(0.95);
  });
});
