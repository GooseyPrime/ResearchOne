/**
 * Wave 5.2 — intent output template descriptors (section order + layout hints).
 * Consumed by dossier UI and echoed in report metadata; does not alter CSL export paths.
 */
export interface IntentOutputTemplate {
  id: string;
  intentId: string;
  title: string;
  /** Ordered section ids for dossier / report chrome. */
  sections: readonly string[];
  /** When true, UI shows skeptical annotations in a collapsible aside. */
  sidebarSkepticAnnotations: boolean;
  /** When false, omit plain-language footer block in dossier chrome. */
  showPlainLanguageFooter: boolean;
  /** Short guidance for synthesizer prompts (future use). */
  narrativeHint: string;
}

export const INTENT_OUTPUT_TEMPLATES: Record<string, IntentOutputTemplate> = {
  intent_factual_report: {
    id: 'intent_factual_report',
    intentId: 'factual_report',
    title: 'Factual report',
    sections: ['who_what_when', 'mechanism', 'sources', 'limits'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Encyclopedic who/what/when/where/how/why; omit contested-claims lane.',
  },
  intent_survey: {
    id: 'intent_survey',
    intentId: 'survey',
    title: 'Survey',
    sections: ['established', 'contested', 'hypothesized', 'lore', 'open_questions'],
    sidebarSkepticAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'Layered exposition; sidebar holds skeptical cross-checks.',
  },
  intent_adjudication: {
    id: 'intent_adjudication',
    intentId: 'adjudication',
    title: 'Adjudication',
    sections: ['claim', 'case_for', 'case_against', 'verdict', 'weaknesses'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Verdict-first layout with strongest cases on both sides.',
  },
  intent_investigation: {
    id: 'intent_investigation',
    intentId: 'investigation',
    title: 'Investigation',
    sections: ['framing', 'primary_evidence', 'contested_zones', 'unresolved'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Symmetric treatment of contested zones.',
  },
  intent_literature_review: {
    id: 'intent_literature_review',
    intentId: 'literature_review',
    title: 'Literature review',
    sections: ['abstract', 'methods', 'findings', 'discussion', 'limitations', 'references'],
    sidebarSkepticAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'PRISMA-style ordering; methodology notes in sidebar.',
  },
  intent_comparative: {
    id: 'intent_comparative',
    intentId: 'comparative',
    title: 'Comparative',
    sections: ['dimensions_table', 'per_option', 'recommendation_optional'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Matrix-first then deep per-option analysis.',
  },
  intent_how_to: {
    id: 'intent_how_to',
    intentId: 'how_to',
    title: 'How-to',
    sections: ['prerequisites', 'steps', 'outcomes', 'troubleshooting'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Numbered procedural flow.',
  },
  intent_recommendation: {
    id: 'intent_recommendation',
    intentId: 'recommendation',
    title: 'Recommendation',
    sections: ['constraints', 'options', 'recommendation', 'tradeoffs'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Decision-layer after comparative options.',
  },
  intent_exploratory: {
    id: 'intent_exploratory',
    intentId: 'exploratory',
    title: 'Exploratory',
    sections: ['editorial_intro', 'highlights', 'why_it_matters'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Curated highlights with editorial framing.',
  },
  intent_position_brief: {
    id: 'intent_position_brief',
    intentId: 'position_brief',
    title: 'Position brief',
    sections: ['disclosure', 'thesis', 'support', 'counters', 'rebuttals'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Partisan disclosure header; rhetorical arc.',
  },
  intent_timeline: {
    id: 'intent_timeline',
    intentId: 'timeline',
    title: 'Timeline',
    sections: ['chronology', 'precision_notes', 'contested_dates'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Chronological with date-precision callouts.',
  },
  intent_reference_lookup: {
    id: 'intent_reference_lookup',
    intentId: 'reference_lookup',
    title: 'Reference lookup',
    sections: ['direct_answer', 'sources', 'confidence'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: false,
    narrativeHint: 'Minimal direct answer + sources + confidence.',
  },
  intent_legacy: {
    id: 'intent_legacy',
    intentId: 'legacy',
    title: 'Standard dossier',
    sections: ['executive_summary', 'evidence', 'analysis', 'conclusion'],
    sidebarSkepticAnnotations: false,
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
