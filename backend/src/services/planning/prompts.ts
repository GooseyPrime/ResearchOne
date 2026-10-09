/**
 * the plan-confirmation pass planning-stage prompts (mutable). Not part of Rule 20
 * `constants/prompts.ts` — no REASONING_FIRST_PREAMBLE wrapping here.
 */

export const INTENT_CLASSIFIER_PROMPT = `You classify the user's research request into exactly one intent id from this closed set:
factual_report, survey, adjudication, investigation, literature_review, comparative, how_to, recommendation, exploratory, position_brief, timeline, reference_lookup

Return ONLY valid JSON (no markdown fences) with shape:
{"intent":"<id>","confidence":0.000-1.000,"reasoning":"<one short paragraph explaining the choice>"}

Rules:
- Pick the single best-matching intent for the speech act (not the topic domain).
- confidence reflects how well the query fits that intent, not epistemic certainty about claims.
- If ambiguous, pick the broader intent and lower confidence below 0.85.`;

/**
 * Phase B — upgraded classifier prompt that returns a full ResearchBrief.
 *
 * Replaces the simple intent-id-only output with:
 * - primary + optional secondary intent
 * - extracted requested artifacts (with exact counts and required subfields)
 * - user constraints that the report must satisfy
 * - epistemic posture
 *
 * The output anchors plan generation, synthesis, verification, and the
 * Deliverable Contract Auditor stage.
 */
export const RESEARCH_BRIEF_CLASSIFIER_PROMPT = `You extract a structured ResearchBrief from the user's research request.

PRIMARY_INTENT — pick exactly one from this closed set:
  factual_report, survey, adjudication, investigation, story_verification,
  opportunity_discovery, feasibility, implementation, literature_review,
  comparative, how_to, recommendation, exploratory, position_brief,
  timeline, reference_lookup

SECONDARY_INTENT — optional; only set when the request is genuinely composite
(e.g. "discover opportunities AND give me a build plan for each" → discovery + implementation).
Use the same closed set. Omit or null if not applicable.

EPISTEMIC_POSTURE — pick exactly one from:
  descriptive   (explain, survey, how-to, factual)
  decision      (recommend, compare, rank)
  discovery     (opportunity, market, whitespace, exploratory)
  adjudicative  (fact-check, verify, story verification)
  causal_test   (hypothesis test, investigation, adversarial)

REQUESTED_ARTIFACTS — list every distinct deliverable the user asked for.
For each artifact include:
  - description: what the user asked for, verbatim or close paraphrase
  - exactCount: integer only when the user stated a specific number (e.g. "ten", "5", "a dozen")
  - requiredFields: list only when the user said each item must contain specific sub-information
                    (e.g. "each with project requirements and a build prompt")

USER_CONSTRAINTS — hard constraints the final report must not violate.
Include things like time budgets ("24-hour build"), tool mandates ("must use Stripe"),
resource limits, audience restrictions, or delivery format requirements.
Omit anything that is merely a preference or suggestion.

Return ONLY valid JSON (no markdown fences) with this exact shape:
{
  "primaryIntent": "<IntentId>",
  "secondaryIntent": "<IntentId or null>",
  "requestedArtifacts": [
    {
      "description": "<string>",
      "exactCount": <integer or null>,
      "requiredFields": ["<string>", ...] or []
    }
  ],
  "userConstraints": [
    { "description": "<string>" }
  ],
  "epistemicPosture": "<descriptive|decision|discovery|adjudicative|causal_test>",
  "confidence": <0.000-1.000>,
  "reasoning": "<one paragraph: why this primary intent and posture>"
}

Rules:
- Preserve the speech act exactly — "find ten opportunities" is discovery, not investigation.
- exactCount must be an integer when explicitly stated; null when absent or ambiguous.
- requiredFields only when the user named mandatory sub-elements for each list item.
- userConstraints are hard limits, not preferences.
- confidence reflects how unambiguous the primary intent is.
- If genuinely ambiguous between two speech acts, pick the broader one, lower confidence below 0.80, and set secondaryIntent.`;

export const PLAN_GENERATOR_PROMPT = `You produce a structured research plan preview for a human confirmation gate.

You will receive: the user query, optional supplemental context, a chosen intent id + confidence + classifier reasoning.

Return ONLY valid JSON (no markdown fences) matching this TypeScript-like shape:
{
  "title": "<a short plain title of the question, 4 to 10 words, as a newspaper would head it>",
  "intent": { "id": "<IntentId>", "displayLabel": "<short human label>", "confidence": number, "reasoning": "<brief>" },
  "topicAnalysis": {
    "summary": "<2-4 plain sentences saying what the person wants to know>",
    "isMultiLayer": boolean,
    "isActivelyContested": boolean,
    "competenceAssessment": "<1-2 plain sentences: how well published sources can answer this, and what may be hard to find>",
    "hardToResearch": boolean
  },
  "orchestrationProfile": {
    "name": "canonical_profile",
    "description": "<1-2 sentences describing the selected per-intent orchestration profile>",
    "agentsWillRun": ["planner","discovery","retrieval","retriever_analysis","reasoning","challenge","synthesis","verification","report_generation","persistence"],
    "agentsWillSkip": []
  },
  "sourceStrategy": {
    "summary": "<1 paragraph>",
    "weightedClasses": ["peer_reviewed","primary_documents","news","grey_literature"],
    "expectedSourceCount": { "min": number, "max": number }
  },
  "outputShape": {
    "structure": "<section heading preview as plain text>",
    "estimatedLength": { "minWords": number, "maxWords": number },
    "documentShape": "<one line>"
  },
  "estimatedCost": {
    "durationSeconds": { "min": number, "max": number },
    "estimatedTokens": number,
    "estimatedCostCents": number | null
  }
}

Use conservative ranges. estimatedCostCents must be null unless the caller instructs otherwise (BYOK/Sovereign billing detail is unknown here).`;

/**
 * RJ-018. How the fields a customer reads on the plan screen are written. The
 * title became the run's name and the two topicAnalysis texts are printed under
 * "What we understood" and "How well we can research this"; both used to come
 * back in the planning model's own vocabulary. Appended to the plan generator
 * and to the plan refinement prompt, and held by `planPlainWords.test.ts`.
 */
export const PLAN_PLAIN_WORDS_INSTRUCTION = `PLAIN WORDS. A member of the public reads "title", "topicAnalysis.summary" and "topicAnalysis.competenceAssessment" on screen. Write them for a general reader with no technical background.
- "title" names the subject of the question in 4 to 10 words, like a headline: "Election security for the 2026 presidential election". It is not a sentence about the request. Never begin it with "The query", "The request", "The user", "This question" or "Analysis of". No numbering, no colon-separated list, no quotation marks, no full stop.
- "topicAnalysis.summary" says in everyday words what the person wants to know. Speak to the person ("You want to know…") or state the subject plainly. Do not describe the request as an object ("The query requires investigating dual dimensions…").
- "topicAnalysis.competenceAssessment" says in everyday words how well published sources can answer this and what may be hard to find, for example: "There is plenty of published material on this. Plans announced after this summer may not be online yet."
- Never use these terms in those three fields: in-distribution, out-of-distribution, OOD, distribution, novelty, novel, retrieval, stack, corpus, pipeline, model, training data, epistemic, multi-layer, dimensions, query, tokens, agent, orchestration, intent.
- Set "topicAnalysis.hardToResearch" to true when the subject is very recent, very specialised, or thinly covered by published sources, and false otherwise. That flag, not the wording, is how the difficulty is recorded.`;

export const PLAN_LENGTH_FIT_INSTRUCTION = `Size estimatedLength to what the question needs. A single-fact question, such as a date, a name, a number, or a yes or no, gets a short answer, on the order of 60 to 150 words. A broad survey gets a full report of 1,500 to 5,000 words; never plan more than 5,000 words unless the request asks for a length. Do not use a fixed length for every question.`;

export const PLAN_REFINEMENT_PROMPT = `You revise a structured plan based on the user's natural-language refinement instruction.

Inputs: original query, current plan JSON, refinement instruction.

Return ONLY valid JSON (no markdown fences):
{
  "revisedPlan": { <same shape as the input plan> },
  "diffSummary": "<plain language bullet summary of what changed>",
  "intentChange": { "detected": boolean, "from": "<IntentId or null>", "to": "<IntentId or null>", "rationale": "<short>" }
}

Constraint: If the refinement is only about sources, length, tone, or section ordering, keep intent.id unchanged and set intentChange.detected false.
If the user clearly requests a different speech act (e.g. fact-check vs survey), set intentChange.detected true and update intent in revisedPlan accordingly.`;
