import type { IntentId } from './intentTaxonomy';

export const GOLDEN_PROMPT_DEPTHS = ['standard', 'deep'] as const;
export type GoldenPromptDepth = (typeof GOLDEN_PROMPT_DEPTHS)[number];

export interface GoldenPromptCase {
  id: string;
  intent: IntentId;
  depth: GoldenPromptDepth;
  prompt: string;
}

const GOLDEN_PROMPT_INTENTS: IntentId[] = [
  'factual_report',
  'survey',
  'adjudication',
  'investigation',
  'story_verification',
  'opportunity_discovery',
  'feasibility',
  'implementation',
  'literature_review',
  'comparative',
  'how_to',
  'recommendation',
  'exploratory',
  'position_brief',
  'timeline',
  'reference_lookup',
  'legacy',
];

const PROMPT_SEEDS = {
  factual_report: {
    standard: 'What regulatory milestones shaped mRNA vaccine commercialization between 2018 and 2024?',
    deep: 'Build a deeply sourced factual record of mRNA vaccine commercialization milestones, separating policy, manufacturing, and post-market safety governance timelines.',
  },
  survey: {
    standard: 'Survey the current state of AI coding assistant evaluation methods.',
    deep: 'Produce a multi-layer survey of AI coding assistant evaluation methods, including benchmark design, human-in-the-loop studies, and deployment reliability evidence.',
  },
  adjudication: {
    standard: 'Fact-check the claim that remote work always decreases software delivery speed.',
    deep: 'Adjudicate whether remote work decreases software delivery speed across contexts, with explicit falsification criteria and contradictory evidence handling.',
  },
  investigation: {
    standard: 'Investigate why a major city rail modernization program went over budget.',
    deep: 'Run an investigative synthesis on rail modernization budget overruns, tracing procurement decisions, governance failures, and competing causal hypotheses.',
  },
  story_verification: {
    standard: 'Verify whether the leaked memo about battery fire risks was authentic.',
    deep: 'Verify the narrative around the leaked battery-risk memo using corroborating records, chain-of-custody clues, and contradiction mapping.',
  },
  opportunity_discovery: {
    standard: 'Find market opportunities in home energy monitoring for renters.',
    deep: 'Discover whitespace opportunities in renter-focused home energy monitoring, including demand signals, competitor gaps, and defensible positioning.',
  },
  feasibility: {
    standard: 'Assess feasibility of launching a city-wide reusable container program in 12 months.',
    deep: 'Evaluate deep feasibility of a city-wide reusable container rollout, including logistics constraints, partner dependencies, and measurable risk mitigations.',
  },
  implementation: {
    standard: 'Create an implementation plan for migrating a monolith to modular services.',
    deep: 'Design a phased implementation roadmap for monolith-to-modular migration with sequencing, rollback gates, staffing assumptions, and milestone validation.',
  },
  literature_review: {
    standard: 'Literature review: biomarkers linked to long-COVID recovery trajectories.',
    deep: 'Conduct a literature review on biomarkers linked to long-COVID recovery trajectories, emphasizing study quality heterogeneity and unresolved mechanism debates.',
  },
  comparative: {
    standard: 'Compare top approaches to synthetic monitoring for SaaS reliability.',
    deep: 'Produce a structured comparative analysis of synthetic monitoring approaches for SaaS reliability across cost, detection latency, and false-positive behavior.',
  },
  how_to: {
    standard: 'How do I build a reproducible incident postmortem process?',
    deep: 'Provide a rigorous how-to guide for building a reproducible incident postmortem process with verification checkpoints and anti-bias safeguards.',
  },
  recommendation: {
    standard: 'Recommend an observability stack for a 25-person startup scaling globally.',
    deep: 'Recommend an observability stack for a globally scaling startup using explicit decision criteria, trade-off scoring, and scenario-dependent alternatives.',
  },
  exploratory: {
    standard: 'Explore surprising applications of low-cost environmental sensors in public health.',
    deep: 'Run an exploratory research sweep on unexpected public-health uses of low-cost environmental sensors, emphasizing novel but evidence-grounded leads.',
  },
  position_brief: {
    standard: 'Draft a position brief defending mandatory software bill of materials for critical infrastructure.',
    deep: 'Build a position brief defending mandatory SBOM requirements for critical infrastructure while engaging strongest counterarguments and policy trade-offs.',
  },
  timeline: {
    standard: 'Construct a timeline of major global chip supply disruptions since 2019.',
    deep: 'Reconstruct a high-confidence timeline of global chip supply disruptions since 2019, including causality notes and unresolved chronology gaps.',
  },
  reference_lookup: {
    standard: 'What year did the FDA authorize the first CRISPR-based therapy?',
    deep: 'Provide a concise reference lookup for the first FDA authorization year of a CRISPR-based therapy, with source and confidence note.',
  },
  legacy: {
    standard: 'Summarize the current evidence around decentralized identity wallets and key implementation trade-offs.',
    deep: 'Produce a full legacy-style dossier on decentralized identity wallets, including evidence quality, contradictions, and unresolved technical risks.',
  },
} satisfies Record<IntentId, { standard: string; deep: string }>;

export const GOLDEN_PROMPT_SUITE: GoldenPromptCase[] = GOLDEN_PROMPT_INTENTS.flatMap((intent) =>
  GOLDEN_PROMPT_DEPTHS.map((depth) => ({
    id: `${intent}:${depth}`,
    intent,
    depth,
    prompt: PROMPT_SEEDS[intent][depth],
  }))
);

export function listGoldenPromptCases(args?: {
  intent?: IntentId;
  depth?: GoldenPromptDepth;
}): GoldenPromptCase[] {
  return GOLDEN_PROMPT_SUITE.filter((item) => {
    if (args?.intent && item.intent !== args.intent) return false;
    if (args?.depth && item.depth !== args.depth) return false;
    return true;
  });
}

export function missingGoldenPromptCoverage(cases: readonly GoldenPromptCase[]): Array<{ intent: IntentId; depth: GoldenPromptDepth }> {
  const seen = new Set(cases.map((item) => `${item.intent}:${item.depth}`));
  const missing: Array<{ intent: IntentId; depth: GoldenPromptDepth }> = [];
  for (const intent of GOLDEN_PROMPT_INTENTS) {
    for (const depth of GOLDEN_PROMPT_DEPTHS) {
      const key = `${intent}:${depth}`;
      if (!seen.has(key)) missing.push({ intent, depth });
    }
  }
  return missing;
}
