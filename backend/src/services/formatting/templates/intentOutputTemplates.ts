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
  /**
   * Singular noun for ONE repeated item in this report type, e.g. an
   * opportunity_discovery report enumerates "Opportunity 1..N" and a comparative
   * report enumerates "Option 1..N".
   *
   * This is a FALLBACK label only. When the drafter supplies the item's concrete
   * name the heading reads "7. Home Fitness Equipment"; `itemLabel` is what the
   * heading falls back to when it does not.
   *
   * Owned by the report type on purpose. The previous implementation guessed the
   * label from the brief's prose by taking the last noun-ish word, which produced
   * "Modeling 1..20" for a list of market opportunities because the request
   * happened to end in a gerund. Report type is knowable; prose is not.
   */
  itemLabel: string;
}

/**
 * WO-AA Phase 7 — evidence burden by claim class.
 *
 * The failure this prevents: requiring a citable corpus chunk before the model
 * may name a market vertical or reason about its economics. That is a category
 * error — it treats analysis as if it were a factual assertion, and it is what
 * drove runs to refuse rather than deliver.
 *
 * Two tiers:
 *   - Analysis and well-established domain knowledge: no citation required.
 *   - Specific factual claims (named prices, named programs/vendors, statistics,
 *     dates, regulatory specifics): a source, or an explicit unverified marker.
 *
 * Appended to non-adjudicative rubrics only. Adjudicative intents keep their
 * stricter, unmodified requirements (PolicyOne).
 */
export const CLAIM_CLASS_SOURCING_BURDEN = `Sourcing requirements by claim class:
- Analysis, reasoning, structural comparisons, and well-established domain
  knowledge do NOT require a citation. Do not fail the report for lacking a
  source behind a judgement, a ranking rationale, or a category description.
- Specific factual claims DO require support: named prices or commission rates,
  named vendors/programs/products presented as currently available, statistics,
  market sizes, dates, and regulatory specifics. Each needs either a cited
  source or an explicit marker such as "(unverified estimate)".
- Modeled numbers must state their assumptions and be recalculable.
- FAIL only for: specific factual claims presented as verified with neither a
  source nor an unverified marker, or fabricated sources, figures, or URLs.

Vocabulary: this report is an analysis built on sources and reasoning. Do not
describe it as "evidence-based" or "evidence-driven", and do not frame it as
adjudicating, verifying, or falsifying a claim — that is a different kind of
report. Say "sources", "signals", or "findings".`;

export const INTENT_OUTPUT_TEMPLATES: Record<string, IntentOutputTemplate> = {
  intent_factual_report: {
    id: 'intent_factual_report',
    intentId: 'factual_report',
    itemLabel: 'Finding',
    title: 'Factual report',
    sections: ['who_what_when', 'mechanism', 'sources', 'limits'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Encyclopedic who/what/when/where/how/why; omit contested-claims lane.',
    verifierRubric: `PASS criteria for a Factual Report:
- Every major claim has an evidence tier tag: (established_fact), (strong_evidence), (testimony), (inference), or (speculation).
- No unsupported conclusions — claims without cited evidence must be labeled (inference) or (speculation).
- Uncertainty and limits of knowledge are acknowledged where the corpus is thin.
- The report stays focused on direct factual explanation rather than adjudicative claim-audit structure.
- Citations exist for all nontrivial factual assertions.
FAIL if: claims are asserted without evidence, uncertainty is papered over, the requested factual answer is withheld, or the report drifts into adversarial claim-audit structure instead of direct explanation.`,
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
    itemLabel: 'Finding',
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
FAIL if: all claims are treated as equally certain, contested zones are not flagged, the survey collapses into a single-hypothesis report, or the report refuses to deliver the requested survey because sourcing is thin.`,
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
    itemLabel: 'Claim',
    title: 'Adjudication',
    sections: ['claim', 'case_for', 'case_against', 'verdict', 'weaknesses'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Verdict-first layout with strongest cases on both sides.',
    verifierRubric: `PASS criteria for an Adjudication:
- The specific claim being adjudicated is clearly stated.
- The strongest case FOR the claim is presented with cited evidence.
- The strongest case AGAINST the claim is presented with cited evidence.
- Major claim statements carry evidence tier tags: (established_fact), (strong_evidence), (testimony), (inference), or (speculation).
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
    itemLabel: 'Finding',
    title: 'Investigation',
    sections: ['framing', 'primary_evidence', 'contested_zones', 'unresolved'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Symmetric treatment of contested zones.',
    verifierRubric: `PASS criteria for an Investigation:
- The contested zones are treated symmetrically — no side receives disproportionate evidential weight without justification.
- Primary evidence is cited and tier-tagged with (established_fact), (strong_evidence), (testimony), (inference), or (speculation).
- Contested zones are explicitly named and analyzed.
- Contradiction analysis is substantive and identifies concrete points of tension.
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
    itemLabel: 'Study',
    title: 'Literature review',
    sections: ['abstract', 'methods', 'findings', 'discussion', 'limitations', 'references'],
    sidebarSkepticAnnotations: true,
    showPlainLanguageFooter: true,
    narrativeHint: 'PRISMA-style ordering; methodology notes in sidebar.',
    verifierRubric: `PASS criteria for a Literature Review:
- Coverage of the relevant literature is documented (scope, search strategy).
- Methodology for source selection is stated.
- Findings are synthesized across sources, not merely listed.
- Major findings carry evidence tier tags: (established_fact), (strong_evidence), (testimony), (inference), or (speculation).
- Limitations of the evidence base are acknowledged.
- Citations are present for all referenced works.
- No unsupported inferences added beyond what the literature supports.
FAIL if: sources are listed without synthesis, search scope is unstated, the review introduces claims not found in the surveyed literature, or the report refuses to synthesize the literature because sourcing is thin.`,
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
    itemLabel: 'Option',
    title: 'Comparative',
    sections: ['dimensions_table', 'per_option', 'recommendation_optional'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Matrix-first then deep per-option analysis.',
    verifierRubric: `PASS criteria for a Comparative:
- All compared options receive equivalent depth of analysis.
- Comparison dimensions are stated explicitly.
- Source references support per-option assessments.
- Trade-offs are named rather than suppressed.
- If a recommendation is included, it references the stated dimensions.
FAIL if: options receive unequal treatment without justification, comparison dimensions are unstated, trade-offs are glossed over, or the report refuses to complete the comparison because sourcing is thin.`,
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
    itemLabel: 'Step',
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
- Each step is backed by source references or clearly identified established practice.
FAIL if: steps are out of order, prerequisites are missing, steps are vague and non-actionable, or the report refuses to provide the procedure because sourcing is thin.`,
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
    itemLabel: 'Recommendation',
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
- The recommendation is consistent with the supporting sources; no conclusion is more confident than its basis.
FAIL if: recommendation is asserted without reasoning, constraints are unstated, trade-offs are suppressed, or the report refuses to recommend because sourcing is thin.`,
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
    itemLabel: 'Direction',
    title: 'Exploratory',
    sections: ['editorial_intro', 'highlights', 'why_it_matters'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Curated highlights with editorial framing.',
    verifierRubric: `PASS criteria for an Exploratory report:
- The report surfaces interesting or non-obvious findings.
- Editorial framing is honest about uncertainty.
- Claims are anchored to source references or clearly labeled as tentative.
- The report does not overstate conclusions — it explicitly marks open questions.
FAIL if: the report asserts definitive conclusions where the findings are exploratory, uncertainty is hidden, or the report refuses to surface findings because sourcing is thin.`,
    requiredDeliverables: [
      'Editorial framing of the exploration',
      'Curated highlights with confidence tags',
      'Why-it-matters context',
      'Open questions or follow-up directions',
    ],
  },
  intent_opportunity_discovery: {
    id: 'intent_opportunity_discovery',
    intentId: 'opportunity_discovery',
    itemLabel: 'Opportunity',
    title: 'Opportunity discovery',
    sections: ['overview', 'opportunities_list', 'ranking_and_analysis', 'recommendations', 'caveats'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint:
      'Ranked opportunity list. Use the confirmed plan as the contract: include exactly the fields the user requested or ResearchOne inferred at plan confirmation. Do not inject implementation guidance unless the user explicitly requested it.',
    verifierRubric: `PASS criteria for an Opportunity Discovery report:
- The requested number of opportunities is present (if an exact count was stated, that count must be met).
- Each opportunity contains the fields explicitly requested by the user or inferred and confirmed in the plan (e.g., ranking, monetization, competition, economics — whatever was confirmed).
- Each opportunity includes at least: a title, a brief description, a ranking rationale, and supporting sources or clearly labeled signals.
- Fields that the user did NOT request are NOT required and must not be flagged as missing.
- Unknown facts are labeled as unknown rather than fabricated or omitted.
- User constraints (e.g., time/budget/tool limits) are respected.
- The report does not critique the premise instead of delivering opportunities.
- The report stays in ranked-opportunity mode rather than drifting into claim-audit or adversarial analysis structure.
- If the initial corpus was incomplete, the report shows that additional retrieval was attempted.
FAIL if: the requested opportunity count is not met; the report delivers a comparative analysis or investigation instead of ranked opportunities; claim-audit or adversarial sections dominate; confirmed required fields are absent; or the report refuses to rank because sourcing is thin (uncertainty should be labeled, not used to abort the deliverable).`,
    requiredDeliverables: [
      'Ranked opportunity list with the exact count requested (or maximum available if no count was stated)',
      'Each opportunity: title, description, and ranking rationale',
      'Each opportunity: user-requested or plan-confirmed information fields (e.g., monetization, competition, economics)',
      'Each opportunity: cited sources or documented signals supporting viability',
      'Unknown or unverified data labeled explicitly rather than omitted or fabricated',
      'Final recommendation or top-N summary',
      'Caveats and confidence notes',
    ],
  },
  intent_feasibility: {
    id: 'intent_feasibility',
    intentId: 'feasibility',
    itemLabel: 'Factor',
    title: 'Feasibility analysis',
    sections: ['summary', 'dimensions', 'risks', 'viability_rating', 'recommendation'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Structured viability assessment with explicit go/no-go recommendation.',
    verifierRubric: `PASS criteria for a Feasibility Analysis:
- Viability dimensions (technical, financial, operational, timeline, risk) are assessed.
- Enabling factors and blockers are enumerated with source support.
- A risk register or key risks section is present.
- An explicit go/no-go or qualified recommendation is rendered.
- Source references or clearly labeled assumptions support each dimension assessment.
FAIL if: a dimension is omitted without explanation, the recommendation is absent, viability claims lack support, or the report refuses to assess feasibility because sourcing is thin.`,
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
    itemLabel: 'Phase',
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
FAIL if: phases are vague, prerequisites are missing, steps are non-actionable, user constraints are violated, or the report refuses to provide an implementation plan because sourcing is thin.`,
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
    itemLabel: 'Claim',
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
    itemLabel: 'Argument',
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
    itemLabel: 'Event',
    title: 'Timeline',
    sections: ['chronology', 'precision_notes', 'contested_dates'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: true,
    narrativeHint: 'Chronological with date-precision callouts.',
    verifierRubric: `PASS criteria for a Timeline:
- Events are in chronological order.
- Date precision is noted where uncertain (e.g., "circa", "reported").
- Contested or disputed dates are flagged.
- Each event carries a source reference and major historical claims carry an evidence tier tag.
- Sources are cited for each event.
FAIL if: events are out of order, date precision is overstated, contested dates are presented as certain, or the report refuses to provide the timeline because sourcing is thin.`,
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
    itemLabel: 'Entry',
    title: 'Reference lookup',
    sections: ['direct_answer', 'sources', 'confidence'],
    sidebarSkepticAnnotations: false,
    showPlainLanguageFooter: false,
    narrativeHint: 'Minimal direct answer + sources + confidence.',
    verifierRubric: `PASS criteria for a Reference Lookup:
- A direct answer is provided.
- Sources are cited.
- Confidence is stated.
FAIL if: the direct answer is absent, sources are missing, the answer is padded with unnecessary analysis, or the report refuses to answer because sourcing is thin.`,
    requiredDeliverables: [
      'Direct answer',
      'Supporting sources',
      'Confidence level',
    ],
  },
  intent_legacy: {
    id: 'intent_legacy',
    intentId: 'legacy',
    itemLabel: 'Item',
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
