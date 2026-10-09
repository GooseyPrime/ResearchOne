import { DOUBLE_CHECK } from './customerOptions';
/** Canonical Tier A copy — reuse verbatim on marketing surfaces and plain intro sections. */

export const HOW_YOUR_REPORT_IS_MADE_HEADING = 'How your report is made';

export const HOW_YOUR_REPORT_IS_MADE_STEPS = [
  'We turn your question into a research plan and show it to you to approve before anything runs—including the report type and how the findings will be checked.',
  'We find and rank relevant sources, then read them.',
  'We draft findings with a citation for every finding.',
  `${DOUBLE_CHECK.description} Investigations also gather the evidence on each side for comparison.`,
  'We keep genuine disagreements between sources visible instead of hiding them.',
  'We verify every citation before finalizing, and you can export the report.',
] as const;

/** Approved marketing one-liner for Double-check. */
export const DOUBLE_CHECK_MARKETING_ONE_LINER =
  'Research that argues against itself before it concludes.';

/** Less common findings stay in view without turning every question into a dispute. */
export const OUTLIER_BRIDGING_ONE_LINER =
  'In an investigation, we keep less common findings and other explanations in view—without turning every question into a dispute.';
