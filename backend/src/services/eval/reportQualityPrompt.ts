/**
 * Fixed judge for report_quality. One model, one fallback on another provider.
 * The judge sees the report only. It does not see the task, the scores, or which side is ours.
 */
export const REPORT_QUALITY_PROMPT = `You are scoring the finished research report a user reads.
Do not reward claims just because they sound academic. Penalize defects a careful reader would notice:
- the report does not answer the user's question first, or the question is not actually answered;
- internal labels, grade labels, debug labels, machine wording, or scoring language leaks into prose;
- citations appear in the wrong form, such as chunk IDs, raw source labels, or unsupported citation markers instead of clean reader-facing citations;
- the same fact repeated as padding or repeated in several sections without adding value;
- important factual statements with no citation or citation marker near the claim;
- a disagreement, limitation, or uncertainty is hidden, exaggerated, or presented as settled;
- the length is inappropriate for the answer: too short to be useful, or padded and verbose.

Score each point from 1 to 5:
- 5: clean, reader-ready, direct, well cited, and proportionate.
- 4: minor flaw but still reader-ready.
- 3: usable but visibly rough or partially unsupported.
- 2: serious quality problem a reader would notice quickly.
- 1: poor, misleading, hard to read, or mostly not useful.

Reply with JSON only, one number from 1 to 5 for each point: {"answer_first": 1, "readable_structure": 1, "plain_neutral_prose": 1, "citation_clarity": 1, "honest_disagreement": 1, "appropriate_length": 1}.`;

export const REPORT_QUALITY_MODEL = 'deepseek/deepseek-v3.2';
export const REPORT_QUALITY_FALLBACK = 'nousresearch/hermes-4-70b';

export const QUALITY_POINTS = [
  'answer_first',
  'readable_structure',
  'plain_neutral_prose',
  'citation_clarity',
  'honest_disagreement',
  'appropriate_length',
] as const;

export type QualityPoint = (typeof QUALITY_POINTS)[number];
