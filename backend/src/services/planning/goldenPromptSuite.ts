import type { IntentId } from './intentTaxonomy';

export interface GoldenPromptCase {
  id: string;
  intent: IntentId;
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
  factual_report: 'What regulatory milestones shaped mRNA vaccine commercialization between 2018 and 2024?',
  survey: 'Survey the current state of AI coding assistant evaluation methods.',
  adjudication: 'Fact-check the claim that remote work always decreases software delivery speed.',
  investigation: 'Investigate why a major city rail modernization program went over budget.',
  story_verification: 'Verify whether the leaked memo about battery fire risks was authentic.',
  opportunity_discovery: 'Find market opportunities in home energy monitoring for renters.',
  feasibility: 'Assess feasibility of launching a city-wide reusable container program in 12 months.',
  implementation: 'Create an implementation plan for migrating a monolith to modular services.',
  literature_review: 'Literature review: biomarkers linked to long-COVID recovery trajectories.',
  comparative: 'Compare top approaches to synthetic monitoring for SaaS reliability.',
  how_to: 'How do I build a reproducible incident postmortem process?',
  recommendation: 'Recommend an observability stack for a 25-person startup scaling globally.',
  exploratory: 'Explore surprising applications of low-cost environmental sensors in public health.',
  position_brief: 'Draft a position brief defending mandatory software bill of materials for critical infrastructure.',
  timeline: 'Construct a timeline of major global chip supply disruptions since 2019.',
  reference_lookup: 'What year did the FDA authorize the first CRISPR-based therapy?',
  legacy: 'Summarize the current evidence around decentralized identity wallets and key implementation trade-offs.',
} satisfies Record<IntentId, string>;

export const GOLDEN_PROMPT_SUITE: GoldenPromptCase[] = GOLDEN_PROMPT_INTENTS.map((intent) => ({
  id: intent,
  intent,
  prompt: PROMPT_SEEDS[intent],
}));

export function listGoldenPromptCases(args?: { intent?: IntentId }): GoldenPromptCase[] {
  return GOLDEN_PROMPT_SUITE.filter((item) => !args?.intent || item.intent === args.intent);
}

export function missingGoldenPromptCoverage(cases: readonly GoldenPromptCase[]): IntentId[] {
  const seen = new Set(cases.map((item) => item.intent));
  return GOLDEN_PROMPT_INTENTS.filter((intent) => !seen.has(intent));
}
