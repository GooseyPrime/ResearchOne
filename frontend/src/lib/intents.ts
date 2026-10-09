/**
 * Report types as the plan screen shows them. The names and descriptions are
 * read from the registry of customer-facing names (`content/customerOptions.ts`).
 */
import { INTENT_DISPLAY_LABELS } from '../constants/intentLabels';
import { customerOptionsIn } from '../content/customerOptions';

export { INTENT_DISPLAY_LABELS };

/** What each report type does, in one sentence. */
export const INTENT_SHORT_DESCRIPTIONS: Record<string, string> = Object.fromEntries(
  customerOptionsIn('report_type').map((option) => [option.id, option.description])
);

/** One example request for each report type. */
export const INTENT_EXAMPLES: Record<string, string> = Object.fromEntries(
  customerOptionsIn('report_type').map((option) => [option.id, option.example])
);
