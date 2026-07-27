import type { IntentId } from '../planning/intentTaxonomy';

export const CORE_AGENT_IDS = [
  'planner',
  'retriever',
  'reasoner',
  'synthesizer',
  'verifier',
] as const;
export type CoreAgentId = (typeof CORE_AGENT_IDS)[number];

export const SPECIALIST_AGENT_ID_LIST = [
  'market_scout',
  'competitor_mapper',
  'demand_signal_analyst',
  'feasibility_architect',
  'story_verifier',
  'timeline_reconstructor',
] as const;
export type SpecialistAgentId = (typeof SPECIALIST_AGENT_ID_LIST)[number];
export type AgentRoleId = CoreAgentId | SpecialistAgentId;

export interface AgentCapability {
  id: AgentRoleId;
  displayName: string;
  description: string;
  supportedIntents: readonly IntentId[];
  costClass: 'low' | 'medium' | 'high';
  canRunInParallel: boolean;
  isSpecialist: boolean;
}

const CORE_AGENT_CAPABILITIES = [
  {
    id: CORE_AGENT_IDS[0],
    displayName: 'Research Planner',
    description: 'Decomposes the request into a structured investigation plan.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: CORE_AGENT_IDS[1],
    displayName: 'Source Investigator',
    description: 'Searches and evaluates source material needed for the run.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: false,
  },
  {
    id: CORE_AGENT_IDS[2],
    displayName: 'Evidence Reasoner',
    description: 'Builds analytical chains from the retrieved evidence.',
    supportedIntents: [] as const,
    costClass: 'high' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: CORE_AGENT_IDS[3],
    displayName: 'Report Writer',
    description: 'Drafts the final deliverable from the confirmed plan.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: CORE_AGENT_IDS[4],
    displayName: 'Citation Verifier',
    description: 'Checks that claims remain supported and uncertainty stays explicit.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
] satisfies readonly AgentCapability[];

const SPECIALIST_AGENT_CAPABILITIES = [
  {
    id: SPECIALIST_AGENT_ID_LIST[0],
    displayName: 'Market Scout',
    description: 'Scans for whitespace opportunities and unserved demand.',
    supportedIntents: ['opportunity_discovery', 'comparative', 'recommendation'] as const,
    costClass: 'high' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: SPECIALIST_AGENT_ID_LIST[1],
    displayName: 'Competitor Mapper',
    description: 'Maps alternatives, positioning, and feature gaps.',
    supportedIntents: ['opportunity_discovery', 'comparative', 'recommendation'] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: SPECIALIST_AGENT_ID_LIST[2],
    displayName: 'Demand Signal Analyst',
    description: 'Reads complaints, search trends, and procurement signals.',
    supportedIntents: ['opportunity_discovery', 'feasibility'] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: SPECIALIST_AGENT_ID_LIST[3],
    displayName: 'Feasibility Architect',
    description: 'Evaluates buildability, stack, timeline, and resource constraints.',
    supportedIntents: ['feasibility', 'implementation', 'opportunity_discovery'] as const,
    costClass: 'high' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
  {
    id: SPECIALIST_AGENT_ID_LIST[4],
    displayName: 'Story Verifier',
    description: 'Cross-checks reported accounts against corroborating evidence.',
    supportedIntents: ['story_verification', 'investigation'] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
  {
    id: SPECIALIST_AGENT_ID_LIST[5],
    displayName: 'Timeline Reconstructor',
    description: 'Reconstructs chronologies from fragmented sources.',
    supportedIntents: ['timeline', 'story_verification', 'investigation'] as const,
    costClass: 'low' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
  {
    id: 'data_analysis_specialist',
    displayName: 'Data Analysis Specialist',
    description: 'Runs quantitative analysis over metrics, benchmarks, and trend data.',
    supportedIntents: ['comparative', 'survey', 'recommendation', 'opportunity_discovery'] as const,
    costClass: 'high' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: 'quantitative_quality_auditor',
    displayName: 'Quantitative Quality Auditor',
    description: 'Audits statistical quality, assumptions, and numerical consistency.',
    supportedIntents: ['comparative', 'survey', 'adjudication', 'investigation'] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
] satisfies readonly AgentCapability[];

export type SpecialistAgentId = (typeof SPECIALIST_AGENT_CAPABILITIES)[number]['id'];

export const AGENT_CAPABILITY_REGISTRY = [
  ...CORE_AGENT_CAPABILITIES,
  ...SPECIALIST_AGENT_CAPABILITIES,
] as const satisfies readonly AgentCapability[];

/** Canonical set of specialist agent IDs — single source of truth for UI/frontend checks. */
export const SPECIALIST_AGENT_IDS = new Set(
  SPECIALIST_AGENT_ID_LIST
);

export function isSpecialistAgentId(id: string): id is SpecialistAgentId {
  return SPECIALIST_AGENT_IDS.has(id);
}

// ────────────────────────────────────────────────────────────────────────────
// Specialist agent response types
// These are the TypeScript interfaces for parsing structured JSON responses
// from specialist agents when execution is wired in follow-on commits.
// ────────────────────────────────────────────────────────────────────────────

export interface MarketScoutOutput {
  opportunities: Array<{ title: string; demand_signal: string; market_gap: string }>;
  summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface CompetitorMapperOutput {
  competitors: Array<{ name: string; positioning: string; strengths: string[]; weaknesses: string[] }>;
  gap_summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface DemandSignalOutput {
  signals: Array<{ type: string; description: string; strength: 'strong' | 'moderate' | 'weak' }>;
  demand_summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface FeasibilityArchitectOutput {
  feasibility_verdict: 'high' | 'medium' | 'low' | 'not_feasible';
  risks: Array<{ factor: string; severity: 'high' | 'medium' | 'low'; mitigation: string }>;
  buildable_paths: string[];
  summary: string;
}

export interface StoryVerifierOutput {
  verdict: 'confirmed' | 'disputed' | 'unverified' | 'false';
  corroborating: string[];
  contradicting: string[];
  unresolved: string[];
  summary: string;
}

export interface TimelineReconstructorOutput {
  events: Array<{ date: string; event: string; confidence: 'high' | 'medium' | 'low'; sources: string[] }>;
  gaps: string[];
  summary: string;
}

export interface DataAnalysisSpecialistOutput {
  metrics: Array<{ metric: string; value: string; interpretation: string }>;
  trend_summary: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface QuantitativeQualityAuditorOutput {
  checks: Array<{ check: string; result: 'pass' | 'warn' | 'fail'; note: string }>;
  risk_summary: string;
  confidence: 'low' | 'medium' | 'high';
}

/**
 * Selects the agents to run for a given `ResearchBrief` intent pair.
 *
 * Core agents (planner, retriever, reasoner, synthesizer, verifier) are always
 * included. Specialist agents are added when `primaryIntent` or `secondaryIntent`
 * appears in their `supportedIntents` list.
 *
 * @param primaryIntent  - The primary intent from the ResearchBrief classifier.
 * @param secondaryIntent - Optional secondary intent; accepts both `IntentId` values
 *   and raw legacy strings (transitional — prefer typed `IntentId` callers).
 */
export function selectAgentsForBrief(
  primaryIntent: IntentId | undefined,
  secondaryIntent?: IntentId | string
): AgentCapability[] {
  // IntentId is a union of string literals, but secondaryIntent also accepts
  // raw strings from legacy callers. The typeof guards ensure that only
  // non-empty string values are added to requestedIntents — filtering out
  // undefined, null, and empty-string inputs before Set insertion.
  const requestedIntents = new Set<string>();
  if (typeof primaryIntent === 'string' && primaryIntent.trim()) requestedIntents.add(primaryIntent);
  if (typeof secondaryIntent === 'string' && secondaryIntent.trim()) requestedIntents.add(secondaryIntent);

  const selected = AGENT_CAPABILITY_REGISTRY.filter(
    (agent) =>
      !agent.isSpecialist ||
      agent.supportedIntents.some((intent) => requestedIntents.has(intent))
  );

  return selected.filter(
    (agent, index, all) => all.findIndex((candidate) => candidate.id === agent.id) === index
  );
}
