/**
 * Wave 5.2 — intent output template descriptors (section order + layout hints).
 * Consumed by dossier UI and echoed in report metadata; does not alter CSL export paths.
 *
 * Phase B — each template now includes:
 * - `verifierRubric`: the per-intent verification criteria used by the verifier agent.
 * - `requiredDeliverables`: canonical checklist for the Deliverable Contract Auditor.
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
  /**
   * Phase B — per-intent verifier rubric.  Used by buildVerifierPromptForIntent()
   * to construct the intent-appropriate verification prompt.
   */
  verifierRubric: string;
  /**
   * Phase B — human-readable checklist of required deliverables for this
   * intent.  Used by the Deliverable Contract Auditor as the canonical contract.
   */
  requiredDeliverables: readonly string[];
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
    verifierRubric: `PASS criteria for a Factual Report:
- Every major claim has an evidence tier tag: (established_fact), (strong_evidence), (testimony), (inference), or (speculation).
- No unsupported conclusions — claims without cited evidence must be labeled (inference) or (speculation).
- Uncertainty and limits of knowledge are acknowledged where the corpus is thin.
- The report does not introduce falsification criteria or contradiction-analysis sections — these are not required for factual reports.
- Citations exist for all nontrivial factual assertions.
FAIL if: claims are asserted without evidence, uncertainty is papered over, or adjudicative sections (falsification, contradiction analysis) dominate.`,
    requiredDeliverables: [
      'Direct factual answer to the research question',
      'Evidence-tagged supporting claims',
      'Source citations for all nontrivial assertions',
      'Acknowledgment of knowledge limits where applicable',
    ],
  },
  intent_survey: {
    id: 'intent_survey',
    intentId: 'survey',
    title: 'Survey',
    sections: ['established', 'contested', 'hypothesized', 'lore', 'open_questions'],
    sidebarSkepticAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'Layered exposition; sidebar holds skeptical cross-checks.',
    verifierRubric: `PASS criteria for a Survey:
- Covers the established, contested, and hypothesized layers of the topic.
- Each layer is clearly distinguished and labeled.
- Evidence tier tags are present on major claims.
- Open questions are acknowledged rather than suppressed.
- Citations support claims in all layers.
FAIL if: all claims are treated as equally certain, contested zones are not flagged, or the survey collapses into a single-hypothesis report.`,
    requiredDeliverables: [
      'Established-knowledge layer with cited evidence',
      'Contested or debated claims layer',
      'Hypothesized or emerging ideas layer',
      'Open questions or knowledge gaps',
    ],
  },
  intent_adjudication: {
    id: 'intent_adjudication',
    intentId: 'adjudication',
    title: 'Adjudication',
    sections: ['claim', 'case_for', 'case_against', 'verdict', 'weaknesses'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Verdict-first layout with strongest cases on both sides.',
    verifierRubric: `PASS criteria for an Adjudication:
- The specific claim being adjudicated is clearly stated.
- The strongest case FOR the claim is presented with cited evidence.
- The strongest case AGAINST the claim is presented with cited evidence.
- A verdict is rendered with explicit confidence and residual uncertainty.
- Falsification criteria are named — what evidence would overturn the verdict.
- Contradiction analysis is substantive (not "no contradictions found").
FAIL if: only one side is represented, verdict lacks confidence statement, or falsification criteria are generic.`,
    requiredDeliverables: [
      'Clear statement of the claim being adjudicated',
      'Strongest supporting evidence for the claim',
      'Strongest counter-evidence against the claim',
      'Explicit verdict with confidence level',
      'Falsification criteria',
    ],
  },
  intent_investigation: {
    id: 'intent_investigation',
    intentId: 'investigation',
    title: 'Investigation',
    sections: ['framing', 'primary_evidence', 'contested_zones', 'unresolved'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Symmetric treatment of contested zones.',
    verifierRubric: `PASS criteria for an Investigation:
- The contested zones are treated symmetrically — no side receives disproportionate evidential weight without justification.
- Primary evidence is cited and tier-tagged.
- Contested zones are explicitly named and analyzed.
- Unresolved questions are acknowledged.
- Falsification criteria are present for adjudicative sub-claims.
- The investigation does not collapse prematurely into a one-sided conclusion.
FAIL if: contested zones are glossed over, evidence is asymmetrically weighted without explanation, or unresolved questions are suppressed.`,
    requiredDeliverables: [
      'Clear framing of what is being investigated',
      'Primary evidence with tier tags',
      'Analysis of contested zones',
      'Unresolved questions',
    ],
  },
  intent_literature_review: {
    id: 'intent_literature_review',
    intentId: 'literature_review',
    title: 'Literature review',
    sections: ['abstract', 'methods', 'findings', 'discussion', 'limitations', 'references'],
    sidebarSkepticAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'PRISMA-style ordering; methodology notes in sidebar.',
    verifierRubric: `PASS criteria for a Literature Review:
- Coverage of the relevant literature is documented (scope, search strategy).
- Methodology for source selection is stated.
- Findings are synthesized across sources, not merely listed.
- Limitations of the evidence base are acknowledged.
- Citations are present for all referenced works.
- No unsupported inferences added beyond what the literature supports.
FAIL if: sources are listed without synthesis, search scope is unstated, or the review introduces claims not found in the surveyed literature.`,
    requiredDeliverables: [
      'Stated scope and search methodology',
      'Synthesized findings across sources',
      'Discussion of patterns and disagreements',
      'Limitations of the evidence base',
      'Reference list',
    ],
  },
  intent_comparative: {
    id: 'intent_comparative',
    intentId: 'comparative',
    title: 'Comparative',
    sections: ['dimensions_table', 'per_option', 'recommendation_optional'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Matrix-first then deep per-option analysis.',
    verifierRubric: `PASS criteria for a Comparative:
- All compared options receive equivalent depth of analysis.
- Comparison dimensions are stated explicitly.
- Evidence supports per-option assessments.
- Trade-offs are named rather than suppressed.
- If a recommendation is included, it references the stated dimensions.
FAIL if: options receive unequal treatment without justification, comparison dimensions are unstated, or trade-offs are glossed over.`,
    requiredDeliverables: [
      'Explicit comparison dimensions',
      'Per-option analysis across all dimensions',
      'Trade-off summary',
      'Optional recommendation based on the comparison',
    ],
  },
  intent_how_to: {
    id: 'intent_how_to',
    intentId: 'how_to',
    title: 'How-to',
    sections: ['prerequisites', 'steps', 'outcomes', 'troubleshooting'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Numbered procedural flow.',
    verifierRubric: `PASS criteria for a How-To:
- Prerequisites are stated before the steps.
- Steps are ordered, numbered, and actionable.
- Expected outcomes are described.
- Common failure modes or troubleshooting notes are included where applicable.
- Each step is backed by cited sources or established practice, not inference.
FAIL if: steps are out of order, prerequisites are missing, or steps are vague and non-actionable.`,
    requiredDeliverables: [
      'Prerequisites',
      'Ordered, numbered, actionable steps',
      'Expected outcomes',
      'Troubleshooting or failure modes',
    ],
  },
  intent_recommendation: {
    id: 'intent_recommendation',
    intentId: 'recommendation',
    title: 'Recommendation',
    sections: ['constraints', 'options', 'recommendation', 'tradeoffs'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Decision-layer after comparative options.',
    verifierRubric: `PASS criteria for a Recommendation:
- The constraints and decision criteria are stated.
- Options were considered (even if not all are elaborated in full).
- The final recommendation is explicit and reasoned.
- Trade-offs of the chosen option are named.
- The recommendation is consistent with the evidence; no conclusion more confident than the evidence.
FAIL if: recommendation is asserted without reasoning, constraints are unstated, or trade-offs are suppressed.`,
    requiredDeliverables: [
      'Stated constraints and decision criteria',
      'Options considered',
      'Explicit recommendation',
      'Trade-offs of the recommended option',
    ],
  },
  intent_exploratory: {
    id: 'intent_exploratory',
    intentId: 'exploratory',
    title: 'Exploratory',
    sections: ['editorial_intro', 'highlights', 'why_it_matters'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Curated highlights with editorial framing.',
    verifierRubric: `PASS criteria for an Exploratory report:
- The report surfaces interesting or non-obvious findings.
- Editorial framing is honest about uncertainty.
- Claims are evidence-tagged.
- The report does not overstate conclusions — it explicitly marks open questions.
FAIL if: the report asserts definitive conclusions where the evidence is exploratory, or uncertainty is hidden.`,
    requiredDeliverables: [
      'Editorial framing of the exploration',
      'Curated highlights with evidence tags',
      'Why-it-matters context',
      'Open questions or follow-up directions',
    ],
  },
  intent_opportunity_discovery: {
    id: 'intent_opportunity_discovery',
    intentId: 'opportunity_discovery',
    title: 'Opportunity discovery',
    sections: ['overview', 'opportunities_list', 'viability_analysis', 'build_guidance', 'caveats'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Ranked opportunity list; each opportunity includes project requirements and actionable build plan. No falsification section.',
    verifierRubric: `PASS criteria for an Opportunity Discovery report:
- The requested number of opportunities is present (if an exact count was stated).
- Each opportunity has a description, viability signal, and evidence citation.
- If build guidance was requested, each opportunity includes actionable build steps.
- User constraints (e.g., time/budget/tool limits) are respected — opportunities violating stated constraints must be flagged or excluded.
- The report does not critique the premise instead of delivering opportunities.
- No falsification or contradiction-analysis sections (not applicable to this intent).
FAIL if: requested artifact count is not met, opportunities lack viability evidence, user constraints are ignored, or the report spends substantial space testing the premise rather than delivering the opportunity list.`,
    requiredDeliverables: [
      'Landscape overview',
      'Ranked or enumerated list of opportunities (count per user request)',
      'Viability signal or evidence for each opportunity',
      'Build guidance per opportunity (if requested)',
      'Caveats and uncertainty',
    ],
  },
  intent_feasibility: {
    id: 'intent_feasibility',
    intentId: 'feasibility',
    title: 'Feasibility analysis',
    sections: ['summary', 'dimensions', 'risks', 'viability_rating', 'recommendation'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Structured viability assessment with explicit go/no-go recommendation.',
    verifierRubric: `PASS criteria for a Feasibility Analysis:
- Viability dimensions (technical, financial, operational, timeline, risk) are assessed.
- Enabling factors and blockers are enumerated with evidence.
- A risk register or key risks section is present.
- An explicit go/no-go or qualified recommendation is rendered.
- Evidence supports each dimension assessment.
FAIL if: a dimension is omitted without explanation, the recommendation is absent, or viability claims lack evidence.`,
    requiredDeliverables: [
      'Viability dimensions assessment',
      'Enabling factors',
      'Blockers and risks',
      'Viability rating or go/no-go recommendation',
    ],
  },
  intent_implementation: {
    id: 'intent_implementation',
    intentId: 'implementation',
    title: 'Implementation plan',
    sections: ['overview', 'prerequisites', 'plan_phases', 'detailed_steps', 'acceptance_criteria'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Ordered build plan with actionable steps and verification criteria.',
    verifierRubric: `PASS criteria for an Implementation Plan:
- Phases or milestones are ordered and actionable.
- Prerequisites are stated.
- Each step is specific enough to act on.
- Acceptance criteria or success indicators are defined.
- User constraints (timeline, tools, budget) are respected in the plan.
FAIL if: phases are vague, prerequisites are missing, steps are non-actionable, or user constraints are violated.`,
    requiredDeliverables: [
      'Overview and goal',
      'Prerequisites',
      'Ordered plan phases or milestones',
      'Detailed actionable steps',
      'Acceptance criteria',
    ],
  },
  intent_story_verification: {
    id: 'intent_story_verification',
    intentId: 'story_verification',
    title: 'Story verification',
    sections: ['claim_summary', 'confirmed', 'unconfirmed', 'false_or_misleading', 'confidence', 'sources'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Source-matrix verification; confirmed / unconfirmed / false; per-claim confidence.',
    verifierRubric: `PASS criteria for a Story Verification:
- Each claim in the story is categorized: confirmed, unconfirmed, or false/misleading.
- Per-claim confidence levels are stated.
- Evidence is cited for confirmed and falsified claims.
- Sources are listed and their reliability assessed.
- Uncertainty about unconfirmed claims is explicit.
FAIL if: claims are not individually addressed, confidence is asserted without evidence, or the "unconfirmed" category is absent.`,
    requiredDeliverables: [
      'Summary of the story or narrative being verified',
      'Confirmed claims with evidence',
      'Unconfirmed or disputed claims',
      'False or misleading claims with counter-evidence',
      'Per-claim confidence rating',
      'Source list',
    ],
  },
  intent_position_brief: {
    id: 'intent_position_brief',
    intentId: 'position_brief',
    title: 'Position brief',
    sections: ['disclosure', 'thesis', 'support', 'counters', 'rebuttals'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Partisan disclosure header; rhetorical arc.',
    verifierRubric: `PASS criteria for a Position Brief:
- Partisan stance is disclosed upfront.
- The thesis is stated clearly.
- Supporting arguments are cited.
- Strongest counterarguments are acknowledged and rebutted.
- The brief does not misrepresent the counter-position.
FAIL if: the partisan stance is undisclosed, counterarguments are ignored, or evidence is fabricated.`,
    requiredDeliverables: [
      'Partisan or positional disclosure',
      'Explicit thesis',
      'Supporting arguments with evidence',
      'Strongest counterarguments',
      'Rebuttals',
    ],
  },
  intent_timeline: {
    id: 'intent_timeline',
    intentId: 'timeline',
    title: 'Timeline',
    sections: ['chronology', 'precision_notes', 'contested_dates'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Chronological with date-precision callouts.',
    verifierRubric: `PASS criteria for a Timeline:
- Events are in chronological order.
- Date precision is noted where uncertain (e.g., "circa", "reported").
- Contested or disputed dates are flagged.
- Sources are cited for each event.
FAIL if: events are out of order, date precision is overstated, or contested dates are presented as certain.`,
    requiredDeliverables: [
      'Chronologically ordered events',
      'Date-precision notes',
      'Contested or uncertain dates',
      'Sources per event',
    ],
  },
  intent_reference_lookup: {
    id: 'intent_reference_lookup',
    intentId: 'reference_lookup',
    title: 'Reference lookup',
    sections: ['direct_answer', 'sources', 'confidence'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: false,
    narrativeHint: 'Minimal direct answer + sources + confidence.',
    verifierRubric: `PASS criteria for a Reference Lookup:
- A direct answer is provided.
- Sources are cited.
- Confidence is stated.
FAIL if: the direct answer is absent, sources are missing, or the answer is padded with unnecessary analysis.`,
    requiredDeliverables: [
      'Direct answer',
      'Supporting sources',
      'Confidence level',
    ],
  },
  intent_legacy: {
    id: 'intent_legacy',
    intentId: 'legacy',
    title: 'Standard dossier',
    sections: ['executive_summary', 'evidence', 'analysis', 'conclusion'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Legacy runs without intent gate.',
    verifierRubric: `PASS criteria for a Standard Dossier (legacy):
- Evidence is cited for major claims.
- Analysis is grounded in the evidence.
- Conclusions are not more confident than the evidence.
FAIL if: claims are unsupported, uncertainty is hidden, or the conclusion contradicts the evidence.`,
    requiredDeliverables: [
      'Executive summary',
      'Evidence section',
      'Analysis',
      'Conclusion',
    ],
  },
};

export function getIntentOutputTemplate(templateId: string | undefined | null): IntentOutputTemplate {
  if (templateId && INTENT_OUTPUT_TEMPLATES[templateId]) {
    return INTENT_OUTPUT_TEMPLATES[templateId]!;
  }
  return INTENT_OUTPUT_TEMPLATES.intent_legacy!;
}
