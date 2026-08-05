/**
 * Wave 5.1 planning-stage prompts (mutable). Not part of Rule 20
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
  "intent": { "id": "<IntentId>", "displayLabel": "<short human label>", "confidence": number, "reasoning": "<brief>" },
  "topicAnalysis": {
    "summary": "<2-4 sentences>",
    "isMultiLayer": boolean,
    "isActivelyContested": boolean,
    "competenceAssessment": "<whether this is in-distribution for a web-retrieval research stack; flag novelty/OOD candidly>"
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
