/**
 * The retrieval similarity floor, resolved from the environment.
 *
 * Extracted from the inline IIFE in `config/index.ts` so it can be tested
 * directly. It could not be before, and that mattered: in PR #224 the default
 * was lowered 0.55 -> 0.45 and the clamp 0.55 -> 0.30, and the only test that
 * touched the value was relaxed in the same change to accept 0.30. Nothing in
 * the suite was left asserting the floor. (Codex, #224 second pass.)
 *
 * The floor is not a tuning knob. It is a guard against a failure that already
 * happened: at `minSimilarity: 0.3`, retrieval matched the operator's own
 * project notes to an unrelated market query and every citation in the
 * resulting report was the user's own documentation (AGENTS.md:207-210). A low
 * threshold does not merely return more chunks — it manufactures false
 * authority.
 *
 * Raising it via `RETRIEVAL_MIN_SIMILARITY` is allowed; lowering it is not.
 * To change the floor itself, run the WO-AE-2 measurement (the same query at
 * 0.55 / 0.45 / 0.35, recording chunk count, source count, and whether the
 * extra chunks are on topic), put the numbers in the PR, and re-run the
 * self-source analysis in Rule 40 against the lower value.
 */

/** The lowest similarity threshold retrieval may ever use. */
export const RETRIEVAL_MIN_SIMILARITY_FLOOR = 0.55;

/**
 * Resolve the default retrieval similarity threshold.
 *
 * An unset, unparseable, or below-floor value all yield the floor. A value
 * above the floor is honoured, so an operator can tighten retrieval without a
 * code change.
 */
export function resolveRetrievalMinSimilarity(raw: string | undefined): number {
  const parsed = parseFloat(raw ?? '');
  if (!Number.isFinite(parsed)) return RETRIEVAL_MIN_SIMILARITY_FLOOR;
  return Math.max(RETRIEVAL_MIN_SIMILARITY_FLOOR, parsed);
}
