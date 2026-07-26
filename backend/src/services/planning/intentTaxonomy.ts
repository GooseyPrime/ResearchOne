export type IntentId =
  | 'factual_report'
  | 'survey'
  | 'adjudication'
  | 'investigation'
  | 'story_verification'
  | 'opportunity_discovery'
  | 'feasibility'
  | 'implementation'
  | 'literature_review'
  | 'comparative'
  | 'how_to'
  | 'recommendation'
  | 'exploratory'
  | 'position_brief'
  | 'timeline'
  | 'reference_lookup'
  | 'legacy';

export interface IntentDefinition {
  id: IntentId;
  displayLabel: string;
  shortDescription: string;
  documentShape: string;
  defaultOrchestrationProfile: string;
  triggerPatterns: RegExp[];
  isMultiLayer: boolean;
}

const TAX: IntentDefinition[] = [
  {
    id: 'factual_report',
    displayLabel: 'Factual report',
    shortDescription: 'Encyclopedic answer for closed-record topics.',
    documentShape: 'Neutral sections with definitions, timeline, and sourced conclusions.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [
      /\bwhat (is|was|are|were)\b/i,
      /\bwho (is|was)\b/i,
      /\bwhen did\b/i,
      /\bdefine\b/i,
      /\btell me about\b/i,
      /\boverview of\b/i,
    ],
    isMultiLayer: false,
  },
  {
    id: 'survey',
    displayLabel: 'Survey',
    shortDescription: 'Layered exposition for multi-layer topics.',
    documentShape: 'Thematic layers with cross-links and open questions.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\blandscape\b/i, /\bhow does X relate\b/i, /\bmultiple (angles|perspectives)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'adjudication',
    displayLabel: 'Adjudication',
    shortDescription: 'Fact-check / verify a specific proposition.',
    documentShape: 'Claim, evidence matrix, verdict, residual uncertainty.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(is it true|true or false|fact[- ]?check|verify (that|whether)|debunk|confirm)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'investigation',
    displayLabel: 'Investigation',
    shortDescription: 'Symmetric deep-dive on contested topics.',
    documentShape: 'Thesis, strongest counter-case, evidence balance, follow-ups.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(contested|disputed|cover[- ]?up|who benefits|what really happened)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'story_verification',
    displayLabel: 'Story verification',
    shortDescription: 'Verify a specific narrative or reported account.',
    documentShape: 'Claim, corroborating evidence, contradicting evidence, verdict.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(is (it|this) (true|accurate|real)|verify (this|the) (story|claim|report)|did (this|that) (really )?happen|fact[- ]?check (this|that))\b/i],
    isMultiLayer: false,
  },
  {
    id: 'opportunity_discovery',
    displayLabel: 'Opportunity discovery',
    shortDescription: 'Surface market or domain opportunities.',
    documentShape: 'Landscape overview, opportunity gaps, sizing signals, recommended moves.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(market opportunity|white space|unmet (need|demand)|emerging (market|space)|where (is|are) (the )?(opportunity|gap))\b/i],
    isMultiLayer: true,
  },
  {
    id: 'feasibility',
    displayLabel: 'Feasibility',
    shortDescription: 'Assess whether a plan or idea is viable.',
    documentShape: 'Viability criteria, enabling factors, blockers, risk register, recommendation.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(feasib|is (it|this) (viable|possible|realistic|practical)|can (we|I|it) (do|build|achieve)|what would it take)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'implementation',
    displayLabel: 'Implementation',
    shortDescription: 'Step-by-step plan for executing a goal.',
    documentShape: 'Prerequisites, phased plan, dependencies, milestones, risks.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(how (do|should|can) (we|I) (implement|build|execute|roll out|launch)|implementation plan|roadmap for|action plan)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'literature_review',
    displayLabel: 'Literature review',
    shortDescription: 'Academic-register review of peer-reviewed sources.',
    documentShape: 'Search strategy, themes, gaps, bibliography-oriented structure.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(literature review|systematic review|peer[- ]?reviewed|pubmed|scholarly)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'comparative',
    displayLabel: 'Comparative',
    shortDescription: 'Structured comparison along consistent dimensions.',
    documentShape: 'Dimension matrix, trade-offs, scenario fit.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(vs\.?|versus|compare|comparison between|difference between|pros and cons)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'how_to',
    displayLabel: 'How-to',
    shortDescription: 'Procedural / step-by-step.',
    documentShape: 'Prerequisites, numbered steps, pitfalls, verification.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\bhow (do|to|can) I\b/i, /\bstep by step\b/i, /\bwalkthrough\b/i],
    isMultiLayer: false,
  },
  {
    id: 'recommendation',
    displayLabel: 'Recommendation',
    shortDescription: 'Decision support with elicited constraints.',
    documentShape: 'Options, criteria, scored recommendation, caveats.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(which (one|option)|should I|recommend|best choice|decide between)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'exploratory',
    displayLabel: 'Exploratory',
    shortDescription: 'Discovery / serendipity.',
    documentShape: 'Branching map, surprising leads, open-ended synthesis.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(surprising|interesting|explore|serendipity|brainstorm)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'position_brief',
    displayLabel: 'Position brief',
    shortDescription: 'Strongest case for a stated position (rhetorical aid).',
    documentShape: 'Position statement, strongest arguments, counter-responses.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(make the case|strongest argument|devil'?s advocate for|defend the (claim|position))\b/i],
    isMultiLayer: false,
  },
  {
    id: 'timeline',
    displayLabel: 'Timeline',
    shortDescription: 'Chronological ordering of events.',
    documentShape: 'Chronology, causal links, uncertainties per date.',
    defaultOrchestrationProfile: 'wave5_placeholder_default',
    triggerPatterns: [/\b(timeline|chronolog|sequence of events|order of events)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'reference_lookup',
    displayLabel: 'Reference lookup',
    shortDescription: 'Single-fact retrieval (lightest pipeline in Wave 5.2).',
    documentShape: 'Short answer with minimal sourcing.',
    defaultOrchestrationProfile: 'wave5_placeholder_reference_lookup',
    triggerPatterns: [/\b(what year|what date|capital of|population of|who won)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'legacy',
    displayLabel: 'Legacy',
    shortDescription: 'Pre–Wave 5.1 runs without intent classification.',
    documentShape: 'Standard ResearchOne dossier.',
    defaultOrchestrationProfile: 'wave5_placeholder_legacy',
    triggerPatterns: [],
    isMultiLayer: false,
  },
];

export const INTENT_TAXONOMY: Record<IntentId, IntentDefinition> = TAX.reduce(
  (acc, d) => {
    acc[d.id] = d;
    return acc;
  },
  {} as Record<IntentId, IntentDefinition>
);

export function getIntentById(id: string): IntentDefinition | null {
  if (id in INTENT_TAXONOMY) return INTENT_TAXONOMY[id as IntentId];
  return null;
}
