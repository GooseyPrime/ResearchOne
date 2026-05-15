/**
 * Thin frontend mirror of Wave 5.1 intent taxonomy (see backend `intentTaxonomy.ts`).
 * Badge labels live in `constants/intentLabels.ts`; descriptions are duplicated here for gate UI.
 */
import { INTENT_DISPLAY_LABELS } from '../constants/intentLabels';

export { INTENT_DISPLAY_LABELS };

/** Short descriptions for the plan confirmation gate (aligned with backend taxonomy). */
export const INTENT_SHORT_DESCRIPTIONS: Record<string, string> = {
  factual_report: 'Encyclopedic answer for closed-record topics.',
  survey: 'Layered exposition for multi-layer topics.',
  adjudication: 'Fact-check / verify a specific proposition.',
  investigation: 'Symmetric deep-dive on contested topics.',
  literature_review: 'Academic-register review of peer-reviewed sources.',
  comparative: 'Structured comparison along consistent dimensions.',
  how_to: 'Procedural / step-by-step.',
  recommendation: 'Decision support with elicited constraints.',
  exploratory: 'Discovery / serendipity.',
  position_brief: 'Strongest case for a stated position (rhetorical aid).',
  timeline: 'Chronological events ordering.',
  reference_lookup: 'Single-fact retrieval (lightest pipeline).',
  legacy: 'Pre-taxonomy run; intent inferred conservatively.',
};
