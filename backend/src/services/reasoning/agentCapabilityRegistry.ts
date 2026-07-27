import type { IntentId } from '../planning/intentTaxonomy';

export interface AgentCapability {
  id: string;
  displayName: string;
  description: string;
  supportedIntents: readonly IntentId[];
  costClass: 'low' | 'medium' | 'high';
  canRunInParallel: boolean;
  isSpecialist: boolean;
}

const CORE_AGENT_CAPABILITIES = [
  {
    id: 'planner',
    displayName: 'Research Planner',
    description: 'Decomposes the request into a structured investigation plan.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: 'retriever',
    displayName: 'Source Investigator',
    description: 'Searches and evaluates source material needed for the run.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: false,
  },
  {
    id: 'reasoner',
    displayName: 'Evidence Reasoner',
    description: 'Builds analytical chains from the retrieved evidence.',
    supportedIntents: [] as const,
    costClass: 'high' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: 'synthesizer',
    displayName: 'Report Writer',
    description: 'Drafts the final deliverable from the confirmed plan.',
    supportedIntents: [] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: false,
  },
  {
    id: 'verifier',
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
    id: 'market_scout',
    displayName: 'Market Scout',
    description: 'Scans for whitespace opportunities and unserved demand.',
    supportedIntents: ['opportunity_discovery', 'comparative', 'recommendation'] as const,
    costClass: 'high' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: 'competitor_mapper',
    displayName: 'Competitor Mapper',
    description: 'Maps alternatives, positioning, and feature gaps.',
    supportedIntents: ['opportunity_discovery', 'comparative', 'recommendation'] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: 'demand_signal_analyst',
    displayName: 'Demand Signal Analyst',
    description: 'Reads complaints, search trends, and procurement signals.',
    supportedIntents: ['opportunity_discovery', 'feasibility'] as const,
    costClass: 'medium' as const,
    canRunInParallel: true,
    isSpecialist: true,
  },
  {
    id: 'feasibility_architect',
    displayName: 'Feasibility Architect',
    description: 'Evaluates buildability, stack, timeline, and resource constraints.',
    supportedIntents: ['feasibility', 'implementation', 'opportunity_discovery'] as const,
    costClass: 'high' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
  {
    id: 'story_verifier',
    displayName: 'Story Verifier',
    description: 'Cross-checks reported accounts against corroborating evidence.',
    supportedIntents: ['story_verification', 'investigation'] as const,
    costClass: 'medium' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
  {
    id: 'timeline_reconstructor',
    displayName: 'Timeline Reconstructor',
    description: 'Reconstructs chronologies from fragmented sources.',
    supportedIntents: ['timeline', 'story_verification', 'investigation'] as const,
    costClass: 'low' as const,
    canRunInParallel: false,
    isSpecialist: true,
  },
] satisfies readonly AgentCapability[];

export const AGENT_CAPABILITY_REGISTRY = [
  ...CORE_AGENT_CAPABILITIES,
  ...SPECIALIST_AGENT_CAPABILITIES,
] as const satisfies readonly AgentCapability[];

/** Canonical set of specialist agent IDs — single source of truth for UI/frontend checks. */
export const SPECIALIST_AGENT_IDS = new Set(
  SPECIALIST_AGENT_CAPABILITIES.map((a) => a.id)
);

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
