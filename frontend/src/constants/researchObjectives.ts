import type { ResearchObjective } from '@/utils/api';

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
};

/** Canonical V2 research objectives (matches backend `modeOverlays` + marketing ModeMatrix). */
export const RESEARCH_OBJECTIVE_OPTIONS: ResearchObjectiveOption[] = [
  {
    value: 'GENERAL_EPISTEMIC_RESEARCH',
    label: 'General Research',
    description: 'Balanced reasoning across competing hypotheses and source corroboration tiers.',
  },
  {
    value: 'INVESTIGATIVE_SYNTHESIS',
    label: 'Investigative Research',
    description: 'Trace incentives, networks, and cross-domain connections.',
  },
  {
    value: 'NOVEL_APPLICATION_DISCOVERY',
    label: 'Application Discovery',
    description: 'Map mechanisms to underexplored implementation paths.',
  },
  {
    value: 'PATENT_GAP_ANALYSIS',
    label: 'Patent Research and Whitespace Mapping',
    description: 'Prior-art landscape, claim boundaries, and novelty gaps.',
  },
  {
    value: 'ANOMALY_CORRELATION',
    label: 'Convergence Analysis',
    description: 'Test whether disparate signals share a structural mechanism.',
  },
];

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
