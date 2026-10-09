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

  /** The part of the prompt that says what the report must contain. */
  function rubricOf(intentId: string): string {
    const prompt = buildVerifierPromptForIntent(intentId, true);
    const start = prompt.indexOf('You are a verification agent for ResearchOne.');
    expect(start).toBeGreaterThan(-1);
    return prompt.slice(start).toLowerCase();
  }

  for (const intentId of ['adjudication', 'investigation', 'story_verification'] as const) {
    it(`${intentId} is checked as a plain report: no falsification, verdict or contradiction-analysis requirement`, () => {
      const rubric = rubricOf(intentId);

      expect(rubric).not.toContain('falsification');
      expect(rubric).not.toContain('contradiction analysis');
      expect(rubric).not.toMatch(/\bverdict/);
      expect(rubric).not.toMatch(/case for|case against|unresolved questions|evidence ledger/);
      // Grade labels appear only as the thing the report must not print.
      expect(rubric).toMatch(/no evidence-tier labels \(such as established_fact/);
      expect(rubric).toContain('fail if');
    });
  }

  it('gives the verifier the same plain rubric for a report type under either method', () => {
    const rubric = (prompt: string): string => prompt.slice(prompt.indexOf('PASS criteria'), prompt.indexOf('Universal minimum'));
    for (const intentId of ['adjudication', 'investigation', 'story_verification'] as const) {
      const underChallenge = buildVerifierPromptForIntent(intentId, true);
      expect(rubric(underChallenge).replace(/\s+$/, '')).toContain(rubric(buildVerifierPromptForIntent(intentId, false)).split('\n\n')[0].trim());
      expect(rubric(underChallenge).toLowerCase()).not.toContain('falsification');
      // The challenge method keeps its stricter sourcing rule.
      expect(underChallenge).toContain('Nontrivial external facts carry a source reference.');
    }
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
