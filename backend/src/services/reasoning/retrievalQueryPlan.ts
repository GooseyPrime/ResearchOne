/**
 * Retrieval query construction.
 *
 * Every query in a run is embedded and matched against the corpus, so two
 * queries that are mostly the same text produce nearly the same vector and
 * return nearly the same chunks. Diversity here is not a nicety — it is what
 * decides how much of the corpus a run can actually see.
 *
 * Run b8265303 is the worked example. Five queries went out and the trace
 * read:
 *
 *   Retrieval 1/5 complete — 10 chunks so far
 *   Retrieval 2/5 complete — 10 chunks so far
 *   Retrieval 3/5 complete — 10 chunks so far
 *   Retrieval 4/5 complete — 10 chunks so far
 *   Retrieval 5/5 complete — 13 chunks so far
 *
 * Queries 2, 3 and 4 contributed nothing. Nine sources holding 10,319 chunks
 * had been ingested; the run cited two of them.
 *
 * Two defects compounded:
 *
 *  1. `deriveTopicSeed` TRUNCATED the objective instead of extracting a topic.
 *     A single-paragraph objective — the ordinary case — has no line break to
 *     split on, so the seed became its first 200 characters of prose. Every
 *     query was then that same 200-character preamble plus a ~60-character
 *     distinguishing clause: roughly 77% shared text, and an embedding is
 *     dominated by whatever the text mostly is.
 *
 *  2. The diversity guard compared a shared prefix against a FIXED 320-char
 *     threshold while the seed was capped at 200. A prefix that is shared by
 *     construction can never exceed a limit set above its own maximum length,
 *     so the guard was unreachable on the path that needed it.
 *
 * The fixes, in the same order: the seed is now a real topic anchor — first
 * sentence, short — and the distinguishing clause LEADS the query so it
 * dominates the embedding. The guard compares a shared prefix as a PROPORTION
 * of the shorter query, so it scales with query length instead of being
 * calibrated past the thing it is meant to catch.
 */

/** A query is one embedding call; long queries dilute rather than sharpen. */
export const RETRIEVAL_QUERY_MAX_CHARS = 512;

/**
 * A topic anchor, not a summary. Long enough to hold a real first sentence —
 * the objective in run b8265303 opens with a 97-character one, and clipping a
 * complete sentence to fit a tighter budget reintroduces exactly the mid-clause
 * fragment this cap exists to prevent — and short enough that it cannot
 * dominate the clause it is attached to, which is what 200 did.
 */
export const TOPIC_SEED_MAX_CHARS = 120;

/**
 * Two queries are too similar when their shared prefix is more than this
 * proportion of the shorter one. A ratio rather than a character count,
 * because the property that matters — "do these ask different things?" — does
 * not scale with absolute length.
 */
export const RETRIEVAL_QUERY_MAX_SHARED_PREFIX_RATIO = 0.5;

/**
 * Below this, a shared prefix is coincidence rather than construction. Two
 * short queries both starting "How" should not trip the guard.
 */
export const RETRIEVAL_QUERY_MIN_SHARED_PREFIX_CHARS = 24;

/**
 * Collapse whitespace runs and trim.
 *
 * Applied before dedup and before the similarity comparison, not merely for
 * tidiness: `trim()` alone leaves `"a  b"` and `"a b"` as distinct Set members
 * AND makes their shared prefix end at the first differing space, so a pair
 * that embeds identically passes both the dedup and the diversity guard
 * (Copilot, #221). Embeddings do not care about extra whitespace, so neither
 * can the checks that decide whether two queries ask different things.
 */
export function normalizeQueryText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

export function commonPrefixLength(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i += 1;
  return i;
}

/** Whether two queries overlap enough to retrieve substantially the same chunks. */
export function queriesAreTooSimilar(a: string, b: string): boolean {
  const shared = commonPrefixLength(a, b);
  if (shared < RETRIEVAL_QUERY_MIN_SHARED_PREFIX_CHARS) return false;
  const shorter = Math.min(a.length, b.length);
  if (shorter === 0) return false;
  return shared / shorter > RETRIEVAL_QUERY_MAX_SHARED_PREFIX_RATIO;
}

/**
 * Reduce a research objective to a short topic anchor.
 *
 * Prefers an explicitly labelled objective line, then the first substantive
 * sentence. Sentence-first is what stops a one-paragraph objective becoming a
 * mid-clause truncation like
 * "...its known failure modes, and the".
 */
export function deriveTopicSeed(query: string, maxChars: number = TOPIC_SEED_MAX_CHARS): string {
  const lines = String(query ?? '')
    .split('\n')
    .map((line) => line.replace(/[#*_`>]+/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);

  const labelled = /^(?:research objective|objective|goal|task|title)\s*[:\-–]\s*(.+)$/i;

  for (const line of lines) {
    const match = labelled.exec(line);
    const candidate = (match?.[1] ?? line).trim();
    if (candidate.length < 12) continue;
    return trimToSentence(candidate, maxChars);
  }

  return trimToSentence(String(query ?? '').replace(/\s+/g, ' ').trim(), maxChars);
}

/**
 * Take the first sentence, or failing that cut on a word boundary.
 *
 * Cutting mid-word or mid-clause leaves a fragment that embeds as noise; a
 * whole clause embeds as a topic.
 */
function trimToSentence(text: string, maxChars: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '';

  const sentenceEnd = normalized.search(/[.?!](?:\s|$)/);
  if (sentenceEnd > 0 && sentenceEnd + 1 <= maxChars) {
    return normalized.slice(0, sentenceEnd).trim();
  }

  if (normalized.length <= maxChars) return normalized;

  const cut = normalized.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Compose one retrieval query from a distinguishing clause and the topic.
 *
 * The clause leads. Putting the shared topic first is what made every query in
 * run b8265303 embed to nearly the same vector.
 */
export function composeRetrievalQuery(
  clause: string,
  topicSeed: string,
  maxChars: number = RETRIEVAL_QUERY_MAX_CHARS
): string {
  const c = (clause ?? '').replace(/\s+/g, ' ').trim();
  const t = (topicSeed ?? '').replace(/\s+/g, ' ').trim();
  if (!c) return t.slice(0, maxChars);
  if (!t) return c.slice(0, maxChars);
  // Skip the anchor when the clause already carries the topic's words.
  if (c.toLowerCase().includes(t.toLowerCase())) return c.slice(0, maxChars);
  return `${c} — ${t}`.slice(0, maxChars);
}

export function buildDeterministicRetrievalQueries(args: {
  subQuestions: string[];
  fallbackQuery: string;
  maxChars: number;
}): string[] {
  const seeded = args.subQuestions
    .map((q) => normalizeQueryText(q.replace(/^Q\d+\s*:\s*/i, '')))
    .filter(Boolean)
    .map((q) => q.slice(0, args.maxChars));
  if (seeded.length > 0) return Array.from(new Set(seeded));
  return [normalizeQueryText(args.fallbackQuery).slice(0, args.maxChars)].filter(Boolean);
}

export function enforceRetrievalQueryBudget(args: {
  retrievalQueries: string[];
  subQuestions: string[];
  fallbackQuery: string;
  maxChars: number;
}): { queries: string[]; warnings: string[] } {
  const warnings: string[] = [];
  const trimmed = args.retrievalQueries.map(normalizeQueryText).filter(Boolean);
  const capped = trimmed.map((q) => (q.length > args.maxChars ? q.slice(0, args.maxChars) : q));
  if (trimmed.some((q, idx) => q.length !== capped[idx]!.length)) {
    warnings.push(`planner retrieval query exceeded ${args.maxChars} chars; truncated`);
  }

  const deduped = Array.from(new Set(capped));

  let tooSimilar = false;
  for (let i = 0; i < deduped.length && !tooSimilar; i += 1) {
    for (let j = i + 1; j < deduped.length; j += 1) {
      if (queriesAreTooSimilar(deduped[i]!, deduped[j]!)) {
        tooSimilar = true;
        break;
      }
    }
  }

  if (tooSimilar) {
    warnings.push(
      `planner retrieval queries overlapped by more than ${Math.round(
        RETRIEVAL_QUERY_MAX_SHARED_PREFIX_RATIO * 100
      )}% of the shorter query; replaced with deterministic sub-question queries`
    );
    return {
      queries: buildDeterministicRetrievalQueries({
        subQuestions: args.subQuestions,
        fallbackQuery: args.fallbackQuery,
        maxChars: args.maxChars,
      }),
      warnings,
    };
  }

  return {
    queries:
      deduped.length > 0
        ? deduped
        : buildDeterministicRetrievalQueries({
            subQuestions: args.subQuestions,
            fallbackQuery: args.fallbackQuery,
            maxChars: args.maxChars,
          }),
    warnings,
  };
}
