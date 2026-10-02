/**
 * Fixed judge for report_quality. One model, one fallback on another provider.
 * The judge sees the report only. It does not see the task, the scores, or which side is ours.
 */
export const REPORT_QUALITY_PROMPT = `You score a research report from 1 to 5 on each point: answer first, readable structure, plain neutral prose, citation clarity, honest disagreement, appropriate length.
Reply with JSON only, one number from 1 to 5 for each point: {"answer_first": 1, "readable_structure": 1, "plain_neutral_prose": 1, "citation_clarity": 1, "honest_disagreement": 1, "appropriate_length": 1}.
5 means a careful reader would treat it as a well-written encyclopedia entry or review article.`;

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
