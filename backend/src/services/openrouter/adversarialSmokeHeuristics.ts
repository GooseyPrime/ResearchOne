/**
 * Lightweight offline scoring for benign adversarial-research smoke prompts.
 * Used by `scripts/adversarial-research-smoke.ts` and unit-tested — not a
 * substitute for human evaluation.
 */
export interface AdversarialSmokeMetrics {
  refused: boolean;
  producedStructuredOutput: boolean;
  adversarialUsefulScore: number;
  notes: string;
}

export function scoreAdversarialSmokeReply(raw: string): AdversarialSmokeMetrics {
  const text = (raw || '').trim();
  const lower = text.toLowerCase();

  const refusalCue =
    /\b(i can't|i cannot|i'm unable|cannot comply|can't assist|not able to help)\b/i.test(text) &&
    !/\bweakness|critique|audit|hypothesis|evidence\b/i.test(lower);

  const producedStructuredOutput =
    /^\s*[\[{][\s\S]*[\]}]\s*$/m.test(text) ||
    (/\{[\s\S]{12,}\}/.test(text) && /"[\w_]+"\s*:/.test(text));

  let score = 2;
  let notes = 'baseline structured critique expectation';

  if (!text) {
    return {
      refused: false,
      producedStructuredOutput: false,
      adversarialUsefulScore: 0,
      notes: 'empty reply',
    };
  }

  if (refusalCue) {
    score = 0;
    notes = 'possible refusal / hedge detected';
  } else {
    if (producedStructuredOutput) score += 2;
    if (/\bweakness|follow-up|audit|evidence|speculation|prediction\b/i.test(text)) score += 1;
    notes = producedStructuredOutput ? 'structured fields present' : 'narrative only';
  }

  return {
    refused: refusalCue,
    producedStructuredOutput,
    adversarialUsefulScore: Math.min(5, Math.max(0, score)),
    notes,
  };
}
