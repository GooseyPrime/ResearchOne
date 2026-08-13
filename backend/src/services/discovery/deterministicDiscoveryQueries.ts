/**
 * Deterministic discovery-query derivation (Rule 42).
 *
 * The discovery planner is an LLM call. When it errors, times out, or returns
 * unparseable JSON, the catch path used to hand back an empty query list and
 * the orchestrator silently skipped external search entirely. Combined with the
 * Rule 40 corpus gate — which seals partitions by design while the corpus is
 * small — that left runs with literally zero evidence and produced reports
 * built on nothing.
 *
 * This module derives usable search queries from the research request itself,
 * with no model call, so discovery can never be silently zeroed.
 */

/** Budget for the discovery-planner prompt (WO-AA Phase 5 / finding F-4). */
export const MAX_PLANNER_QUERY_CHARS = 10_000;
export const MAX_PLANNER_PLAN_CHARS = 6_000;

/** Truncate with an explicit marker so the model knows content was elided. */
export function capForPlannerPrompt(value: string, max: number): string {
  const text = value ?? '';
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n...[truncated: ${text.length} chars total]`;
}

/** Replace verbatim copies of the query inside serialized plan JSON. */
export function redactQueryEcho(serialized: string, query: string): string {
  const needle = (query ?? '').trim();
  if (needle.length < 400) return serialized;

  let out = serialized.split(needle).join('[see Research Query above]');
  // The plan is JSON-serialized before this runs, so the embedded copy carries
  // escaped newlines and quotes. Matching only the raw form made this a no-op.
  const escaped = JSON.stringify(needle).slice(1, -1);
  if (escaped !== needle) {
    out = out.split(escaped).join('[see Research Query above]');
  }
  return out;
}

/** Words that carry no retrieval signal. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'that', 'this', 'with', 'from', 'into', 'onto', 'your', 'you',
  'are', 'was', 'were', 'been', 'being', 'have', 'has', 'had', 'not', 'but', 'all',
  'any', 'can', 'may', 'must', 'should', 'would', 'could', 'will', 'shall', 'each',
  'their', 'there', 'these', 'those', 'them', 'they', 'than', 'then', 'when', 'what',
  'which', 'while', 'where', 'who', 'whom', 'how', 'why', 'use', 'used', 'using',
  'do', 'does', 'did', 'done', 'per', 'via', 'out', 'own', 'new', 'one', 'two',
  'research', 'report', 'objective', 'identify', 'rank', 'best', 'conduct', 'study',
  'analysis', 'analyze', 'provide', 'produce', 'include', 'including', 'required',
  'requirement', 'requirements', 'section', 'sections', 'exactly', 'following',
  'above', 'below', 'must', 'should', 'consider', 'evaluate', 'assess', 'determine',
]);

const MAX_QUERIES = 6;
const MIN_TERM_LENGTH = 4;

/**
 * Pull the most salient multi-word phrases and terms out of a research request.
 * Prefers the first heading / opening sentences, which carry the topic, over the
 * long instruction tail that follows in structured prompts.
 */
export function buildDeterministicDiscoveryQueries(researchQuery: string, plan?: unknown): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();

  const push = (candidate: string) => {
    const cleaned = candidate.replace(/\s+/g, ' ').trim();
    if (cleaned.length < 8 || cleaned.length > 180) return;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    queries.push(cleaned);
  };

  // 1) Retrieval queries already present on the execution plan are the highest
  //    signal source — they were derived from the confirmed brief.
  const planQueries = extractPlanQueries(plan);
  for (const q of planQueries) {
    push(q);
    if (queries.length >= MAX_QUERIES) return queries;
  }

  // 2) The topic line: first markdown heading, else the first sentence.
  const topic = extractTopicLine(researchQuery);
  if (topic) {
    push(topic);
    const keywords = salientTerms(topic);
    if (keywords.length >= 2) {
      push(keywords.slice(0, 6).join(' '));
    }
  }

  // 3) Salient terms across the whole request, as a broad backstop.
  if (queries.length < MAX_QUERIES) {
    const broad = salientTerms(researchQuery).slice(0, 8);
    if (broad.length >= 3) {
      push(broad.slice(0, 5).join(' '));
      if (broad.length >= 6) push(broad.slice(3, 8).join(' '));
    }
  }

  return queries.slice(0, MAX_QUERIES);
}

function extractPlanQueries(plan: unknown): string[] {
  if (!plan || typeof plan !== 'object') return [];
  const record = plan as Record<string, unknown>;
  const out: string[] = [];
  for (const key of ['retrieval_queries', 'discovery_queries', 'search_queries']) {
    const value = record[key];
    if (!Array.isArray(value)) continue;
    for (const entry of value) {
      if (typeof entry === 'string' && entry.trim().length > 0) {
        // Structured prompts sometimes carry the whole request as one "query";
        // those are useless as search strings.
        if (entry.length <= 180) out.push(entry);
      }
    }
  }
  return out;
}

function extractTopicLine(text: string): string | null {
  const heading = text.match(/^#{1,3}\s*(?:research\s+objective\s*[:\-–]?\s*)?(.+)$/im);
  if (heading?.[1]) {
    const line = heading[1].replace(/[*_`#]/g, '').trim();
    if (line.length >= 8) return line.slice(0, 180);
  }
  const firstSentence = text
    .replace(/^#.*$/gm, '')
    .split(/(?<=[.?!])\s+/)
    .map((s) => s.replace(/[*_`#]/g, '').trim())
    .find((s) => s.length >= 20);
  return firstSentence ? firstSentence.slice(0, 180) : null;
}

function salientTerms(text: string): string[] {
  const counts = new Map<string, number>();
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= MIN_TERM_LENGTH && !STOPWORDS.has(w) && !/^\d+$/.test(w));
  for (const word of words) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => (b[1] - a[1]) || a[0].localeCompare(b[0]))
    .map(([word]) => word);
}
