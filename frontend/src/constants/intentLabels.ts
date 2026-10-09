import { customerOptionsIn } from '../content/customerOptions';

/**
 * The name of each report type, by its id. The words are written once, in the
 * registry of customer-facing names (`content/customerOptions.ts`).
 */
export const INTENT_DISPLAY_LABELS: Record<string, string> = Object.fromEntries(
  customerOptionsIn('report_type').map((option) => [option.id, option.name])
);
