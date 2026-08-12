import { describe, expect, it } from 'vitest';

import { buildVerifierPromptForIntent } from '../services/openrouter/openrouterService';

function lowerPrompt(intentId: string, isAdjudicative = false): string {
  return buildVerifierPromptForIntent(intentId, isAdjudicative).toLowerCase();
}

describe('buildVerifierPromptForIntent', () => {
  const nonAdjudicativeIntentIds = ['comparative', 'opportunity_discovery', 'how_to', 'implementation'] as const;

  for (const intentId of nonAdjudicativeIntentIds) {
    it(`${intentId} omits adjudicative verifier vocabulary`, () => {
      const prompt = lowerPrompt(intentId);

      expect(prompt).not.toContain('established_fact');
      expect(prompt).not.toContain('falsification');
      expect(prompt).not.toContain('contradiction analysis');
    });
  }

  it('adjudication preserves evidence-tier and falsification requirements', () => {
    const prompt = lowerPrompt('adjudication', true);

    expect(prompt).toContain('established_fact');
    expect(prompt).toContain('falsification');
    expect(prompt).toContain('contradiction analysis');
  });

  it('investigation preserves evidence-tier and falsification requirements', () => {
    const prompt = lowerPrompt('investigation', true);

    expect(prompt).toContain('established_fact');
    expect(prompt).toContain('falsification');
    expect(prompt).toContain('contradiction analysis');
  });

  it('literature_review retains evidence-tier requirements and fails refusal-to-deliver', () => {
    const prompt = lowerPrompt('literature_review');

    expect(prompt).toContain('established_fact');
    expect(prompt).toContain('refus');
    expect(prompt).toContain('fail if');
  });

  it('defaults to the standard verifier path when isAdjudicative is omitted', () => {
    const prompt = buildVerifierPromptForIntent('comparative');

    expect(prompt).not.toContain('ATTENTION: STRICT EPISTEMOLOGICAL DIRECTIVE IN EFFECT.');
  });

  it('pins the adjudication verifier prompt', () => {
    expect(buildVerifierPromptForIntent('adjudication', true)).toMatchSnapshot();
  });
});
