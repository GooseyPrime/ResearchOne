/**
 * Retrieval query construction.
 *
 * Every query in a run is embedded and matched against the corpus, so two
 * queries that are mostly the same text produce nearly the same vector and
 * return nearly the same chunks. How much of the corpus a run can see depends
 * on the queries being genuinely different from each other.
 *
 * Run b8265303 is the worked example. Five queries went out and the trace read:
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
 *     split on, so the seed became its first 200 characters of prose, ending
 *     mid-clause on "…its known failure modes, and the".
 *
 *  2. That seed was then PREFIXED onto every query, so each was ~77% identical
 *     text, and the diversity guard compared a shared prefix against a fixed
 *     320-character threshold while the seed was capped at 200 — a prefix
 *     shared by construction could never exceed a limit set above its own
 *     maximum length.
 *
 * The fix for (2) is not to detect the redundancy but to stop creating it. The
 * queries are the topic seed and the brief's own artifact and constraint
 * clauses, each as written. Nothing is appended to anything, so there is no
 * shared preamble or shared anchor to detect, strip, or tune a threshold
 * against — and the guard that remains has one job: catch two queries that say
 * the same thing, wherever that similarity came from.
 *
 * A clause too thin to retrieve on by itself is the one exception, and takes
 * the topic seed so it has something to match.
 */

/** A query is one embedding call; long queries dilute rather than sharpen. */
export const RETRIEVAL_QUERY_MAX_CHARS = 512;

/**
 * A topic anchor, not a summary. Long enough to hold a real first sentence —
 * the objective in run b8265303 opens with a 97-character one, and clipping a
 * complete sentence to fit a tighter budget reintroduces exactly the
 * mid-clause fragment this cap exists to prevent.
 */
export const TOPIC_SEED_MAX_CHARS = 120;

/**
 * Two queries are too similar when they share more than this proportion of
 * their significant tokens.
 *
 * One test, over the whole query. Position does not matter: shared text at the
 * front and shared text at the back put two embeddings in the same place
 * equally well.
 */
export const RETRIEVAL_QUERY_MAX_TOKEN_OVERLAP = 0.6;

/**
 * Below this many significant tokens a clause cannot retrieve anything on its
 * own, and takes the topic seed with it.
 */
export const CLAUSE_MIN_TOKENS_TO_STAND_ALONE = 4;

/** Collapse whitespace runs and trim. */
export function normalizeQueryText(text: string): string {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Significant tokens of a query.
 *
 * Unicode-aware. An ASCII-only split returned NOTHING for Chinese, Japanese,
 * Arabic or Cyrillic, scoring every such pair 0 and blinding the guard to the
 * redundancy it exists to catch (Codex, #221). Scripts that do not space their
 * words yield no word tokens, so those fall back to character bigrams —
 * language independent, and engaged only when word tokenization finds nothing,
 * so Latin-script behaviour is unchanged.
 */
function significantTokens(text: string): Set<string> {
  const normalized = normalizeQueryText(text).toLowerCase();
  if (!normalized) return new Set();

  const words = normalized.split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 2);
  if (words.length > 0) return new Set(words);

  const dense = normalized.replace(/[^\p{L}\p{N}]+/gu, '');
  const bigrams = new Set<string>();
  for (let i = 0; i + 1 < dense.length; i += 1) bigrams.add(dense.slice(i, i + 2));
  return bigrams;
}

/** How much a query actually specifies. */
export function querySpecificity(text: string): number {
  return significantTokens(text).size;
}

/** Jaccard overlap of two queries' significant tokens. */
export function tokenOverlapRatio(a: string, b: string): number {
  const ta = significantTokens(a);
  const tb = significantTokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared += 1;
  return shared / (ta.size + tb.size - shared);
}

/** Whether two queries overlap enough to retrieve substantially the same chunks. */
export function queriesAreTooSimilar(a: string, b: string): boolean {
  return tokenOverlapRatio(a, b) > RETRIEVAL_QUERY_MAX_TOKEN_OVERLAP;
}

/**
 * The shortest run of text that can plausibly be a sentence rather than an
 * abbreviation artefact. "Compare U.S" is 11 characters and names nothing.
 */
const MIN_SENTENCE_CHARS = 24;

/**
 * Tokens that end in a period without ending a sentence. Matched
 * case-insensitively against the word before a candidate boundary.
 */
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st',
  'inc', 'ltd', 'co', 'corp', 'dept', 'est',
  'eg', 'ie', 'etc', 'vs', 'cf', 'al', 'approx', 'fig', 'no', 'vol', 'ch', 'pp',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sept', 'sep', 'oct', 'nov', 'dec',
]);

/**
 * Whether a candidate '.' at `index` ends an abbreviation rather than a
 * sentence.
 *
 * Dotted initialisms are matched on SHAPE rather than by collapsing them to a
 * short token: stripping the dots from "U.S" gives "us", which is neither a
 * single letter nor a listed abbreviation, so
 * "…policies across the U.S. and Canada." was cut at "…the U.S", dropping the
 * comparison target (Codex, #221).
 */
function isAbbreviationBoundary(text: string, index: number): boolean {
  if (text[index] !== '.') return false;

  let start = index;
  while (start > 0 && /[A-Za-z.]/.test(text[start - 1]!)) start -= 1;
  const raw = text.slice(start, index);
  if (!raw) return false;

  if (/^(?:\p{L}+\.)+\p{L}+$/u.test(raw)) return true;

  const token = raw.replace(/\./g, '').toLowerCase();
  if (!token) return false;
  return token.length === 1 || ABBREVIATIONS.has(token);
}

/** Take the first sentence, or failing that cut on a word boundary. */
function trimToSentence(text: string, maxChars: number): string {
  const normalized = normalizeQueryText(text);
  if (!normalized) return '';

  const boundary = /[.?!](?:\s|$)/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(normalized)) !== null) {
    const index = match.index;
    if (isAbbreviationBoundary(normalized, index)) continue;
    if (index < MIN_SENTENCE_CHARS) continue;
    if (index + 1 > maxChars) break;
    return normalized.slice(0, index).trim();
  }

  if (normalized.length <= maxChars) return normalized;

  const cut = normalized.slice(0, maxChars);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trim();
}

/**
 * Reduce a research objective to a short topic anchor.
 *
 * Prefers an explicitly labelled objective line, then the first substantive
 * sentence. Sentence-first is what stops a one-paragraph objective becoming a
 * mid-clause truncation.
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
 * A brief's clause as a retrieval query.
 *
 * Returned as written. Appending the topic to every clause is what created the
 * redundancy this module exists to prevent, so the only clause that takes the
 * topic is one with too few significant tokens to match anything by itself.
 */
export function composeRetrievalQuery(
  clause: string,
  topicSeed: string,
  maxChars: number = RETRIEVAL_QUERY_MAX_CHARS
): string {
  const c = normalizeQueryText(clause);
  const t = normalizeQueryText(topicSeed);
  if (!c) return t.slice(0, maxChars);
  if (!t) return c.slice(0, maxChars);
  if (querySpecificity(c) >= CLAUSE_MIN_TOKENS_TO_STAND_ALONE) return c.slice(0, maxChars);
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

  // Drop redundant members, keep the rest.
  //
  // Two rules, both learned the hard way. Replacing the WHOLE set on one
  // overlapping pair took unrelated retrieval angles down with a single
  // duplicate. And on a pair, the MORE SPECIFIC query wins rather than the
  // earlier one: the bare seed is inserted first, so keeping the earlier
  // member kept the broad seed and discarded the enriched query, leaving the
  // distinguishing angle unsearched. Ties keep the earlier query, so the
  // result is deterministic. (Codex, #221)
  const kept: string[] = [];
  const dropped: string[] = [];
  for (const query of deduped) {
    const rivalIndex = kept.findIndex((k) => queriesAreTooSimilar(k, query));
    if (rivalIndex === -1) {
      kept.push(query);
      continue;
    }
    if (querySpecificity(query) > querySpecificity(kept[rivalIndex]!)) {
      dropped.push(kept[rivalIndex]!);
      kept[rivalIndex] = query;
      continue;
    }
    dropped.push(query);
  }

  if (dropped.length > 0) {
    warnings.push(
      `dropped ${dropped.length} planner retrieval quer${dropped.length === 1 ? 'y' : 'ies'} `
        + 'that duplicated another by more than the overlap budget'
    );
  }

  return {
    queries:
      kept.length > 0
        ? kept
        : buildDeterministicRetrievalQueries({
            subQuestions: args.subQuestions,
            fallbackQuery: args.fallbackQuery,
            maxChars: args.maxChars,
          }),
    warnings,
  };
}
