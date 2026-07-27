// Requests under ~12 words rarely contain enough context for scope and output shape;
// this threshold is an initial heuristic and can be tuned as usage data accumulates.
export const CLARIFY_MIN_WORDS = 12;

// Scope-boundary keywords signal the user has already constrained geography, timeline, or audience.
// Common words like 'by'/'within' are intentionally included as weak but fast signals.
export const SCOPE_BOUNDARY_PATTERN = /\b(by|within|deadline|budget|scope|market|region|industry)\b/i;

// Output-format keywords indicate the user knows what artifact they want (table, steps, etc.).
export const OUTPUT_FORMAT_PATTERN = /\b(compare|rank|recommend|steps|plan|roadmap|table)\b/i;

/**
 * Lightweight ambiguity heuristic for optional pre-plan clarifications.
 * We trigger at most two questions when the prompt appears underspecified:
 * - Fewer than CLARIFY_MIN_WORDS words: prompt is too short to infer output shape (ask for type).
 *   If the prompt is long enough but lacks explicit format markers, ask how to organize results instead.
 * - No SCOPE_BOUNDARY match: user hasn't named a timeline, geography, budget, or audience.
 * The two categories (output shape and scope) are kept mutually exclusive to avoid asking
 * two similar output-format questions when both word-count and format checks fire.
 */
export function buildClarifyingQuestions(query: string): string[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/).filter(Boolean);
  const questions: string[] = [];

  // Short prompts lack output shape entirely; longer prompts may still lack a format preference.
  if (words.length < CLARIFY_MIN_WORDS) {
    questions.push('What specific output do you need (for example: comparison, ranked list, implementation steps)?');
  } else if (!OUTPUT_FORMAT_PATTERN.test(trimmed)) {
    questions.push('How should results be organized (ranked options, narrative briefing, or step-by-step guide)?');
  }
  if (!SCOPE_BOUNDARY_PATTERN.test(trimmed)) {
    questions.push('Any scope boundaries we should enforce (timeline, geography, budget, or target audience)?');
  }
  return questions;
}
