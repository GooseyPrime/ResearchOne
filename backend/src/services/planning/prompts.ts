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
    "name": "wave5_placeholder_default",
    "description": "<1-2 sentences — Wave 5.2 will replace with real profiles>",
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
