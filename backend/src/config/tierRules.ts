/**
 * Tier rules configuration — matches the spec from Work Order G / Section 13.
 *
 * Each tier defines: allowed research objectives (modes), report caps,
 * feature flags, and wallet/export behavior.
 */

import type { ResearchObjective } from '../services/reasoning/reasoningModelPolicy';

export type TierName =
  | 'anonymous'
  | 'free_demo'
  | 'student'
  | 'wallet'
  | 'pro'
  | 'team'
  | 'byok'
  | 'sovereign'
  | 'admin';

export interface TierRule {
  label: string;
  allowedObjectives: readonly ResearchObjective[];
  lifetimeReportCap: number | null;
  monthlyReportCap: number | null;
  monthlyDeepReportCap: number | null;
  walletFallbackEnabled: boolean;
  parallelSearch: boolean;
  parallelExtract: boolean;
  smartCitations: boolean;
  livingReportsIncluded: boolean;
  adversarialTwinIncluded: boolean;
  provenanceLedgerIncluded: boolean;
  corpusAccess: boolean;
  atlasAccess: boolean;
  knowledgeGraphAccess: boolean;
  deepResearchAccess: boolean;
  exportFormats: readonly string[];
}

const ALL_OBJECTIVES: readonly ResearchObjective[] = [
  'GENERAL_EPISTEMIC_RESEARCH',
  'INVESTIGATIVE_SYNTHESIS',
  'NOVEL_APPLICATION_DISCOVERY',
  'PATENT_GAP_ANALYSIS',
  'ANOMALY_CORRELATION',
] as const;

export const TIER_RULES: Record<TierName, TierRule> = {
  anonymous: {
    label: 'Anonymous',
    allowedObjectives: [],
    lifetimeReportCap: 0,
    monthlyReportCap: 0,
    monthlyDeepReportCap: 0,
    walletFallbackEnabled: false,
    parallelSearch: false,
    parallelExtract: false,
    smartCitations: false,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: false,
    atlasAccess: false,
    knowledgeGraphAccess: false,
    deepResearchAccess: false,
    exportFormats: [],
  },

  free_demo: {
    label: 'Free Demo',
    allowedObjectives: ['GENERAL_EPISTEMIC_RESEARCH'],
    lifetimeReportCap: 3,
    monthlyReportCap: null,
    monthlyDeepReportCap: null,
    walletFallbackEnabled: false,
    parallelSearch: false,
    parallelExtract: false,
    smartCitations: false,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: false,
    atlasAccess: false,
    knowledgeGraphAccess: false,
    deepResearchAccess: true,
    exportFormats: ['markdown'],
  },

  student: {
    label: 'Student',
    allowedObjectives: ['GENERAL_EPISTEMIC_RESEARCH', 'INVESTIGATIVE_SYNTHESIS'],
    lifetimeReportCap: null,
    monthlyReportCap: 10,
    monthlyDeepReportCap: 2,
    walletFallbackEnabled: true,
    parallelSearch: false,
    parallelExtract: false,
    smartCitations: true,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: false,
    atlasAccess: false,
    knowledgeGraphAccess: false,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf'],
  },

  wallet: {
    label: 'Wallet (Pay-per-Report)',
    allowedObjectives: ['GENERAL_EPISTEMIC_RESEARCH', 'INVESTIGATIVE_SYNTHESIS'],
    lifetimeReportCap: null,
    monthlyReportCap: null,
    monthlyDeepReportCap: null,
    walletFallbackEnabled: true,
    parallelSearch: false,
    parallelExtract: false,
    smartCitations: true,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: false,
    atlasAccess: false,
    knowledgeGraphAccess: false,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf'],
  },

  pro: {
    label: 'Pro',
    allowedObjectives: ALL_OBJECTIVES,
    lifetimeReportCap: null,
    monthlyReportCap: 25,
    monthlyDeepReportCap: 5,
    walletFallbackEnabled: true,
    parallelSearch: true,
    parallelExtract: true,
    smartCitations: true,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: true,
    atlasAccess: true,
    knowledgeGraphAccess: true,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf', 'docx'],
  },

  team: {
    label: 'Team',
    allowedObjectives: ALL_OBJECTIVES,
    lifetimeReportCap: null,
    monthlyReportCap: 100,
    monthlyDeepReportCap: 20,
    walletFallbackEnabled: true,
    parallelSearch: true,
    parallelExtract: true,
    smartCitations: true,
    livingReportsIncluded: true,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: true,
    corpusAccess: true,
    atlasAccess: true,
    knowledgeGraphAccess: true,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf', 'docx'],
  },

  byok: {
    label: 'BYOK',
    allowedObjectives: ALL_OBJECTIVES,
    lifetimeReportCap: null,
    monthlyReportCap: null,
    monthlyDeepReportCap: null,
    walletFallbackEnabled: false,
    parallelSearch: true,
    parallelExtract: true,
    smartCitations: true,
    livingReportsIncluded: false,
    adversarialTwinIncluded: false,
    provenanceLedgerIncluded: false,
    corpusAccess: true,
    atlasAccess: true,
    knowledgeGraphAccess: true,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf', 'docx'],
  },

  sovereign: {
    label: 'Sovereign',
    allowedObjectives: ALL_OBJECTIVES,
    lifetimeReportCap: null,
    monthlyReportCap: null,
    monthlyDeepReportCap: null,
    walletFallbackEnabled: false,
    parallelSearch: true,
    parallelExtract: true,
    smartCitations: true,
    livingReportsIncluded: true,
    adversarialTwinIncluded: true,
    provenanceLedgerIncluded: true,
    corpusAccess: true,
    atlasAccess: true,
    knowledgeGraphAccess: true,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf', 'docx', 'json'],
  },

  admin: {
    label: 'Admin',
    allowedObjectives: ALL_OBJECTIVES,
    lifetimeReportCap: null,
    monthlyReportCap: null,
    monthlyDeepReportCap: null,
    walletFallbackEnabled: false,
    parallelSearch: true,
    parallelExtract: true,
    smartCitations: true,
    livingReportsIncluded: true,
    adversarialTwinIncluded: true,
    provenanceLedgerIncluded: true,
    corpusAccess: true,
    atlasAccess: true,
    knowledgeGraphAccess: true,
    deepResearchAccess: true,
    exportFormats: ['markdown', 'pdf', 'docx', 'json'],
  },
} as const;

export function isTierName(value: string): value is TierName {
  return Object.hasOwn(TIER_RULES, value);
}

/** Higher index = broader research / export entitlements (preorder, not total order). */
const TIER_ENTITLEMENT_RANK: Record<TierName, number> = {
  anonymous: 0,
  free_demo: 1,
  student: 2,
  wallet: 3,
  pro: 4,
  team: 5,
  byok: 6,
  sovereign: 7,
  admin: 8,
};

export function tierNameFromUnknown(raw: string | null | undefined, fallback: TierName = 'free_demo'): TierName {
  if (!raw) return fallback;
  return isTierName(raw) ? raw : fallback;
}

export function maxTierByEntitlementRank(a: TierName, b: TierName): TierName {
  return TIER_ENTITLEMENT_RANK[a] >= TIER_ENTITLEMENT_RANK[b] ? a : b;
}
