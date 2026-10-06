/**
 * Fixed judge for report_quality. One model, one fallback on another provider.
 * The judge sees the report only. It does not see the task, the scores, or which side is ours.
 */
export const REPORT_QUALITY_PROMPT = `You are scoring the finished research report a reader is given. You are shown the report only, not the question it was written for, so judge everything from the report itself.

Work in two steps. First list the defects you can point to in the text. Then score six points. A point starts at 5 and is lowered only for a defect you listed; a report with no listed defect scores 5 on every point. Do not reward a report for sounding academic.

Defects to look for, and the point each one lowers:
- answer_first: the report does not open with its main finding; a reader gets background or method before the conclusion. Score 2 or lower.
- plain_neutral_prose: wording meant for the system and not the reader appears in the text, such as evidence tiers, grades, verifier or pass/fail status, confidence numbers or debug labels. Score 2 or lower, and lower readable_structure by one.
- citation_clarity: citations are in an internal form such as [Chunk 3] or raw source labels instead of plain numbered references: score 2 or lower. Factual statements carry no citations at all, or there is no reference list: score 1.
- appropriate_length: the same fact is stated again in several places without adding anything, or the report is padded or too thin to be useful. Score 2 or lower, and lower plain_neutral_prose by one.
- honest_disagreement: a limit, uncertainty or disagreement in the evidence is hidden, overstated or presented as settled. Score 2 or lower.
- readable_structure: headings and paragraphs do not help a reader find things, or sections restate each other. Score 3 or lower.

Reply with JSON only, in this shape, the defects first: {"defects": ["short description of each defect, or an empty list"], "answer_first": 5, "readable_structure": 5, "plain_neutral_prose": 5, "citation_clarity": 5, "honest_disagreement": 5, "appropriate_length": 5}. Each score is a whole number from 1 to 5.`;

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
