import { customerOptionName } from '../content/customerOptions';

// Keep in sync with backend/src/services/formatting/templates/intentOutputTemplates.ts
/**
 * the orchestration-profile pass — intent output template descriptors (section order + layout hints).
 * Consumed by dossier UI and echoed in report metadata; does not alter CSL export paths.
 */
export interface IntentOutputTemplate {
  id: string;
  intentId: string;
  title: string;
  /** Ordered section ids for dossier / report chrome. */
  sections: readonly string[];
  /** When true, UI shows the challenge notes in a collapsible aside. */
  sidebarDoubleCheckAnnotations: boolean;
  /** When false, omit plain-language footer block in dossier chrome. */
  showPlainLanguageFooter: boolean;
  /** Short guidance for synthesizer prompts (future use). */
  narrativeHint: string;
}

export const INTENT_OUTPUT_TEMPLATES: Record<string, IntentOutputTemplate> = {
  intent_factual_report: {
    id: 'intent_factual_report',
    intentId: 'factual_report',
    title: customerOptionName('report_type', 'factual_report'),
    sections: ['who_what_when', 'mechanism', 'sources', 'limits'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Encyclopedic who/what/when/where/how/why; plain informational prose.',
  },
  intent_survey: {
    id: 'intent_survey',
    intentId: 'survey',
    title: customerOptionName('report_type', 'survey'),
    sections: ['established', 'contested', 'hypothesized', 'lore', 'open_questions'],
    sidebarDoubleCheckAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'Layered exposition; sidebar holds the challenge notes.',
  },
  intent_adjudication: {
    id: 'intent_adjudication',
    intentId: 'adjudication',
    title: customerOptionName('report_type', 'adjudication'),
    sections: ['claim', 'case_for', 'case_against', 'verdict', 'weaknesses'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Verdict-first layout with strongest cases on both sides.',
  },
  intent_investigation: {
    id: 'intent_investigation',
    intentId: 'investigation',
    title: customerOptionName('report_type', 'investigation'),
    sections: ['framing', 'primary_evidence', 'contested_zones', 'unresolved'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Symmetric treatment of contested zones.',
  },
  intent_literature_review: {
    id: 'intent_literature_review',
    intentId: 'literature_review',
    title: customerOptionName('report_type', 'literature_review'),
    sections: ['abstract', 'methods', 'findings', 'discussion', 'limitations', 'references'],
    sidebarDoubleCheckAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'PRISMA-style ordering; methodology notes in sidebar.',
  },
  intent_comparative: {
    id: 'intent_comparative',
    intentId: 'comparative',
    title: customerOptionName('report_type', 'comparative'),
    sections: ['dimensions_table', 'per_option', 'recommendation_optional'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Matrix-first then deep per-option analysis.',
  },
  intent_how_to: {
    id: 'intent_how_to',
    intentId: 'how_to',
    title: customerOptionName('report_type', 'how_to'),
    sections: ['prerequisites', 'steps', 'outcomes', 'troubleshooting'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Numbered procedural flow.',
  },
  intent_recommendation: {
    id: 'intent_recommendation',
    intentId: 'recommendation',
    title: customerOptionName('report_type', 'recommendation'),
    sections: ['constraints', 'options', 'recommendation', 'tradeoffs'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Decision-layer after comparative options.',
  },
  intent_exploratory: {
    id: 'intent_exploratory',
    intentId: 'exploratory',
    title: customerOptionName('report_type', 'exploratory'),
    sections: ['editorial_intro', 'highlights', 'why_it_matters'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Curated highlights with editorial framing.',
  },
  intent_position_brief: {
    id: 'intent_position_brief',
    intentId: 'position_brief',
    title: customerOptionName('report_type', 'position_brief'),
    sections: ['disclosure', 'thesis', 'support', 'counters', 'rebuttals'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Partisan disclosure header; rhetorical arc.',
  },
  intent_timeline: {
    id: 'intent_timeline',
    intentId: 'timeline',
    title: customerOptionName('report_type', 'timeline'),
    sections: ['chronology', 'precision_notes', 'contested_dates'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Chronological with date-precision callouts.',
  },
  intent_reference_lookup: {
    id: 'intent_reference_lookup',
    intentId: 'reference_lookup',
    title: customerOptionName('report_type', 'reference_lookup'),
    sections: ['direct_answer', 'sources', 'confidence'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: false,
    narrativeHint: 'Minimal direct answer + sources + confidence.',
  },
  intent_opportunity_discovery: {
    id: 'intent_opportunity_discovery',
    intentId: 'opportunity_discovery',
    title: customerOptionName('report_type', 'opportunity_discovery'),
    sections: ['overview', 'opportunities_list', 'ranking_and_analysis', 'recommendations', 'caveats'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Ranked opportunity list with user-requested fields. No falsification section.',
  },
  intent_feasibility: {
    id: 'intent_feasibility',
    intentId: 'feasibility',
    title: customerOptionName('report_type', 'feasibility'),
    sections: ['summary', 'dimensions', 'risks', 'viability_rating', 'recommendation'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Viability-first with enabling factors, blockers, and a clear recommendation.',
  },
  intent_implementation: {
    id: 'intent_implementation',
    intentId: 'implementation',
    title: customerOptionName('report_type', 'implementation'),
    sections: ['overview', 'prerequisites', 'plan_phases', 'detailed_steps', 'acceptance_criteria'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Phased execution plan with numbered steps, dependencies, and milestones.',
  },
  intent_story_verification: {
    id: 'intent_story_verification',
    intentId: 'story_verification',
    title: customerOptionName('report_type', 'story_verification'),
    sections: ['claim_summary', 'confirmed', 'unconfirmed', 'false_or_misleading', 'confidence', 'sources'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Narrative accuracy check; confirmed vs. disputed vs. unverifiable.',
  },
  intent_legacy: {
    id: 'intent_legacy',
    intentId: 'legacy',
    title: customerOptionName('report_type', 'legacy'),
    sections: ['executive_summary', 'evidence', 'analysis', 'conclusion'],
    sidebarDoubleCheckAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Legacy runs without intent gate.',
  },
};

export function getIntentOutputTemplate(templateId: string | undefined | null): IntentOutputTemplate {
  if (templateId && INTENT_OUTPUT_TEMPLATES[templateId]) {
    return INTENT_OUTPUT_TEMPLATES[templateId]!;
  }
  return INTENT_OUTPUT_TEMPLATES.intent_legacy!;
}
