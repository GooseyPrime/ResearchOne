import type { ResearchObjective } from '@/utils/api';
import { customerOption } from '@/content/customerOptions';

export type EntitlementTierKey =
  | 'free_demo'
  | 'student'
  | 'wallet'
  | 'pro'
  | 'team'
  | 'byok'
  | 'sovereign'
  | 'admin';

export type ResearchObjectiveOption = {
  value: ResearchObjective;
  label: string;
  description: string;
  example: string;
};

/** The objectives a request can name, in the order the form lists them. */
const RESEARCH_OBJECTIVE_VALUES: readonly ResearchObjective[] = [
  'GENERAL_EPISTEMIC_RESEARCH',
  'INVESTIGATIVE_SYNTHESIS',
  'NOVEL_APPLICATION_DISCOVERY',
  'PATENT_GAP_ANALYSIS',
  'ANOMALY_CORRELATION',
];

/**
 * The research objectives, with the name, description and example each one has
 * in the registry of customer-facing names (`content/customerOptions.ts`).
 */
export const RESEARCH_OBJECTIVE_OPTIONS: ResearchObjectiveOption[] = RESEARCH_OBJECTIVE_VALUES.map((value) => {
  const words = customerOption('research_objective', value);
  return { value, label: words.name, description: words.description, example: words.example };
});

export const TIER_ALLOWED_OBJECTIVES: Record<EntitlementTierKey, readonly ResearchObjective[]> = {
  free_demo: ['GENERAL_EPISTEMIC_RESEARCH'],
  student: ['GENERAL_EPISTEMIC_RESEARCH', 'INVESTIGATIVE_SYNTHESIS'],
  wallet: ['GENERAL_EPISTEMIC_RESEARCH', 'INVESTIGATIVE_SYNTHESIS'],
  pro: [
    'GENERAL_EPISTEMIC_RESEARCH',
    'INVESTIGATIVE_SYNTHESIS',
    'NOVEL_APPLICATION_DISCOVERY',
    'PATENT_GAP_ANALYSIS',
    'ANOMALY_CORRELATION',
  ],
  team: [
    'GENERAL_EPISTEMIC_RESEARCH',
    'INVESTIGATIVE_SYNTHESIS',
    'NOVEL_APPLICATION_DISCOVERY',
    'PATENT_GAP_ANALYSIS',
    'ANOMALY_CORRELATION',
  ],
  byok: [
    'GENERAL_EPISTEMIC_RESEARCH',
    'INVESTIGATIVE_SYNTHESIS',
    'NOVEL_APPLICATION_DISCOVERY',
    'PATENT_GAP_ANALYSIS',
    'ANOMALY_CORRELATION',
  ],
  sovereign: [
    'GENERAL_EPISTEMIC_RESEARCH',
    'INVESTIGATIVE_SYNTHESIS',
    'NOVEL_APPLICATION_DISCOVERY',
    'PATENT_GAP_ANALYSIS',
    'ANOMALY_CORRELATION',
  ],
  admin: [
    'GENERAL_EPISTEMIC_RESEARCH',
    'INVESTIGATIVE_SYNTHESIS',
    'NOVEL_APPLICATION_DISCOVERY',
    'PATENT_GAP_ANALYSIS',
    'ANOMALY_CORRELATION',
  ],
};

export function objectivesForTier(tier: EntitlementTierKey | null | undefined): ResearchObjectiveOption[] {
  const allowed =
    tier != null
      ? (TIER_ALLOWED_OBJECTIVES[tier] ?? TIER_ALLOWED_OBJECTIVES.free_demo)
      : RESEARCH_OBJECTIVE_OPTIONS.map((o) => o.value);
  return RESEARCH_OBJECTIVE_OPTIONS.filter((o) => allowed.includes(o.value));
}

export function defaultObjectiveForTier(tier: EntitlementTierKey | null | undefined): ResearchObjective {
  return objectivesForTier(tier)[0]?.value ?? 'GENERAL_EPISTEMIC_RESEARCH';
}

/** Plain-language label for a research objective value (Rule 36 — lookup by value, not array index). */
export function researchObjectiveLabel(value: ResearchObjective): string {
  return RESEARCH_OBJECTIVE_OPTIONS.find((o) => o.value === value)?.label ?? value;
}
