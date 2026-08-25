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
    defaultOrchestrationProfile: 'factual_report',
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
    defaultOrchestrationProfile: 'survey',
    triggerPatterns: [/\blandscape\b/i, /\bhow does X relate\b/i, /\bmultiple (angles|perspectives)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'adjudication',
    displayLabel: 'Adjudication',
    shortDescription: 'Fact-check / verify a specific proposition.',
    documentShape: 'Claim, evidence matrix, verdict, residual uncertainty.',
    defaultOrchestrationProfile: 'adjudication',
    triggerPatterns: [/\b(is it true|true or false|fact[- ]?check|verify (that|whether)|debunk|confirm)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'investigation',
    displayLabel: 'Investigation',
    shortDescription: 'Symmetric deep-dive on contested topics.',
    documentShape: 'Thesis, strongest counter-case, evidence balance, follow-ups.',
    defaultOrchestrationProfile: 'investigation',
    triggerPatterns: [
      /\b(contested|disputed|cover[- ]?up|who benefits|what really happened)\b/i,
      // "Investigate why X went over budget" is the plainest way anyone asks
      // for this and matched nothing, so it fell through to the model — and
      // when the model was unavailable, to factual_report.
      /\binvestigat\w*/i,
      /\broot cause\b/i,
      // Deliberately NOT a bare `why (did|does)`: "why does Postgres use
      // MVCC?" is an explanation, not an investigation, and routing it here
      // would trade one misroute for a commoner one.
      /\bwhy\b[^.?!]{0,60}\b(fail(ed|ure)?|collapse\w*|overr(a|u)n|over budget|went wrong|delayed|cancell?ed)\b/i,
    ],
    isMultiLayer: true,
  },
  {
    id: 'story_verification',
    displayLabel: 'Story verification',
    shortDescription: 'Verify a specific narrative or reported account.',
    documentShape: 'Claim, corroborating evidence, contradicting evidence, verdict.',
    defaultOrchestrationProfile: 'story_verification',
    triggerPatterns: [
      /\b(is (it|this) (true|accurate|real)|did (this|that) (really )?happen|fact[- ]?check (this|that))\b/i,
      // "Verify whether this story is true" used to match ADJUDICATION's
      // `verify (that|whether)` and nothing here, so a story to check came
      // back shaped as a claim/case-for/case-against/verdict document instead
      // of confirmed / unconfirmed / false-or-misleading. The words between
      // "verify" and the thing being verified are not the point.
      /\bverif\w*\b[^.?!]{0,40}\b(story|stories|account|report|reporting|article|narrative|claim)s?\b/i,
      /\b(story|account|article|report)\b[^.?!]{0,40}\b(is|are) (true|accurate|real|false)\b/i,
    ],
    isMultiLayer: false,
  },
  {
    id: 'opportunity_discovery',
    displayLabel: 'Opportunity discovery',
    shortDescription: 'Surface market or domain opportunities.',
    documentShape: 'Landscape overview, opportunity gaps, sizing signals, recommended moves.',
    defaultOrchestrationProfile: 'opportunity_discovery',
    triggerPatterns: [
      /\b(market opportunity|white space|unmet (need|demand)|emerging (market|space)|where (is|are) (the )?(opportunity|gap))\b/i,
      // The operator's own request — "find me 20 affiliate marketing niches
      // ranked by income potential" — matched nothing at all.
      /\bniches?\b/i,
      /\bopportunit\w*/i,
      /\branked by\b[^.?!]{0,40}\b(potential|income|revenue|profit|demand|value)\b/i,
      /\b(ideas|ways)\b[^.?!]{0,20}\b(to|for)\b[^.?!]{0,20}\b(make|earn|monetis|monetiz|start)\w*/i,
    ],
    isMultiLayer: true,
  },
  {
    id: 'feasibility',
    displayLabel: 'Feasibility',
    shortDescription: 'Assess whether a plan or idea is viable.',
    documentShape: 'Viability criteria, enabling factors, blockers, risk register, recommendation.',
    defaultOrchestrationProfile: 'feasibility',
    // `\b(feasib|…)\b` could never match "feasible": there is no word
    // boundary between "b" and "l", so the alternative only matched the
    // non-word "feasib". Every feasibility question fell through to the model.
    triggerPatterns: [
      /\bfeasib\w*/i,
      /\b(is (it|this) (viable|possible|realistic|practical)|can (we|i|it) (do|build|achieve)|what would it take)\b/i,
    ],
    isMultiLayer: false,
  },
  {
    id: 'implementation',
    displayLabel: 'Implementation',
    shortDescription: 'Step-by-step plan for executing a goal.',
    documentShape: 'Prerequisites, phased plan, dependencies, milestones, risks.',
    defaultOrchestrationProfile: 'implementation',
    triggerPatterns: [/\b(how (do|should|can) (we|I) (implement|build|execute|roll out|launch)|implementation plan|roadmap for|action plan)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'literature_review',
    displayLabel: 'Literature review',
    shortDescription: 'Academic-register review of peer-reviewed sources.',
    documentShape: 'Search strategy, themes, gaps, bibliography-oriented structure.',
    defaultOrchestrationProfile: 'literature_review',
    triggerPatterns: [/\b(literature review|systematic review|peer[- ]?reviewed|pubmed|scholarly)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'comparative',
    displayLabel: 'Comparative',
    shortDescription: 'Structured comparison along consistent dimensions.',
    documentShape: 'Dimension matrix, trade-offs, scenario fit.',
    defaultOrchestrationProfile: 'comparative',
    triggerPatterns: [/\b(vs\.?|versus|compare|comparison between|difference between|pros and cons)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'how_to',
    displayLabel: 'How-to',
    shortDescription: 'Procedural / step-by-step.',
    documentShape: 'Prerequisites, numbered steps, pitfalls, verification.',
    defaultOrchestrationProfile: 'how_to',
    triggerPatterns: [/\bhow (do|to|can) I\b/i, /\bstep by step\b/i, /\bwalkthrough\b/i],
    isMultiLayer: false,
  },
  {
    id: 'recommendation',
    displayLabel: 'Recommendation',
    shortDescription: 'Decision support with elicited constraints.',
    documentShape: 'Options, criteria, scored recommendation, caveats.',
    defaultOrchestrationProfile: 'recommendation',
    triggerPatterns: [
      // "should I" missed "should we", which is how anyone asking on behalf of
      // a team phrases it.
      /\b(which (one|option)|should (i|we)|recommend\w*|best choice|decide between)\b/i,
      /\bwhich\b[^.?!]{0,40}\bshould (i|we)\b/i,
    ],
    isMultiLayer: true,
  },
  {
    id: 'exploratory',
    displayLabel: 'Exploratory',
    shortDescription: 'Discovery / serendipity.',
    documentShape: 'Branching map, surprising leads, open-ended synthesis.',
    defaultOrchestrationProfile: 'exploratory',
    triggerPatterns: [/\b(surprising|interesting|explore|serendipity|brainstorm)\b/i],
    isMultiLayer: true,
  },
  {
    id: 'position_brief',
    displayLabel: 'Position brief',
    shortDescription: 'Strongest case for a stated position (rhetorical aid).',
    documentShape: 'Position statement, strongest arguments, counter-responses.',
    defaultOrchestrationProfile: 'position_brief',
    triggerPatterns: [/\b(make the case|strongest argument|devil'?s advocate for|defend the (claim|position))\b/i],
    isMultiLayer: false,
  },
  {
    id: 'timeline',
    displayLabel: 'Timeline',
    shortDescription: 'Chronological ordering of events.',
    documentShape: 'Chronology, causal links, uncertainties per date.',
    defaultOrchestrationProfile: 'timeline',
    triggerPatterns: [/\b(timeline|chronolog|sequence of events|order of events)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'reference_lookup',
    displayLabel: 'Reference lookup',
    shortDescription: 'Single-fact retrieval (lightest pipeline in Wave 5.2).',
    documentShape: 'Short answer with minimal sourcing.',
    defaultOrchestrationProfile: 'reference_lookup',
    triggerPatterns: [/\b(what year|what date|capital of|population of|who won)\b/i],
    isMultiLayer: false,
  },
  {
    id: 'legacy',
    displayLabel: 'Legacy',
    shortDescription: 'Pre–Wave 5.1 runs without intent classification.',
    documentShape: 'Standard ResearchOne dossier.',
    defaultOrchestrationProfile: 'legacy',
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
