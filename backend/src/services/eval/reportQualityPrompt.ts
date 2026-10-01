/**
 * Fixed judge for report_quality. One model, one fallback on another provider.
 * The judge sees the report only. It does not see the task, the scores, or which side is ours.
 */
export const REPORT_QUALITY_PROMPT = `You score a research report from 1 to 5 on each point: answer first, readable structure, plain neutral prose, citation clarity, honest disagreement, appropriate length.
Reply with JSON only: {"score": 1} to {"score": 5}.
5 means a careful reader would treat it as a well-written encyclopedia entry or review article.
Do not prefer either text because it came first.`;

export const REPORT_QUALITY_MODEL = 'deepseek/deepseek-v3.2';
export const REPORT_QUALITY_FALLBACK = 'nousresearch/hermes-4-70b';
