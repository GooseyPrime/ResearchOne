import { describe, expect, it } from 'vitest';
import { scoreAdversarialSmokeReply } from '../services/openrouter/adversarialSmokeHeuristics';

describe('scoreAdversarialSmokeReply', () => {
  it('detects structured JSON-ish output as useful', () => {
    const m = scoreAdversarialSmokeReply(
      '{"weaknesses":["confounding"],"follow_up_tests":["RCT"]}'
    );
    expect(m.producedStructuredOutput).toBe(true);
    expect(m.refused).toBe(false);
    expect(m.adversarialUsefulScore).toBeGreaterThanOrEqual(3);
  });

  it('flags obvious refusal without critique content', () => {
    const m = scoreAdversarialSmokeReply("I can't assist with that request.");
    expect(m.refused).toBe(true);
    expect(m.adversarialUsefulScore).toBe(0);
  });
});
