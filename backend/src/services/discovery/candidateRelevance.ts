/**
 * Is this discovered source about the thing the user asked about?
 *
 * Providers are attached to SPECIALISTS, not to the request:
 * `data_analysis_specialist`, `quantitative_quality_auditor` and
 * `feasibility_architect` each fire arXiv, PubMed Central, USPTO and
 * ClinicalTrials. Those APIs return *something* for almost any string, and
 * nothing between the API response and the ingest queue asked whether the
 * something was on topic. That is how a scoping review of depression on
 * Reddit, a paper on identifying Enterobacteriaceae, and an HPLC assay for
 * nitrite ended up cited in a market-opportunity report.
 *
 * The fix is not to remove the academic providers — academic sources are
 * exactly right for some requests. The fix is that a returned result has to
 * look like it is about the query before it is worth fetching, embedding and
 * storing.
 *
 * Deterministic on purpose. A model deciding relevance is another model call
 * that can be satisfied by plausibility, and this is a mechanical property of
 * two strings (Rule 42 R42-1).
 */

/**
 * Words that carry no topic. Kept short: an aggressive stop list starts
 * deleting the words that make a query specific.
 */
const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'best', 'but', 'by', 'can', 'could',
  'do', 'does', 'for', 'from', 'get', 'give', 'has', 'have', 'how', 'i', 'if', 'in',
  'into', 'is', 'it', 'its', 'list', 'make', 'me', 'most', 'my', 'need', 'new', 'of',
  'on', 'or', 'our', 'over', 'report', 'research', 'should', 'show', 'so', 'some',
  'that', 'the', 'their', 'them', 'then', 'there', 'these', 'they', 'this', 'to', 'top',
  'us', 'use', 'using', 'want', 'was', 'we', 'were', 'what', 'when', 'where', 'which',
  'who', 'why', 'will', 'with', 'would', 'you', 'your',
]);

/** Crude singularisation so "markets" matches "market". */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith('es') && !word.endsWith('ses')) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1);
  return word;
}

export function topicTerms(text: string): Set<string> {
  const out = new Set<string>();
  for (const raw of (text ?? '').toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    if (!raw || raw.length < 3) continue;
    if (STOPWORDS.has(raw)) continue;
    out.add(stem(raw));
  }
  return out;
}

export interface RelevanceVerdict {
  /** Fraction of the query's topic terms the candidate mentions. */
  ratio: number;
  matchedTerms: number;
  /** False when the candidate does not look like it is about the query. */
  onTopic: boolean;
}

/**
 * The bar.
 *
 * Two matched terms, or a fifth of the query's vocabulary. Deliberately low:
 * a false negative here silently removes a good source from the evidence base,
 * which is a worse failure than a weak source the retrieval similarity floor
 * will decline to cite anyway.
 */
const MIN_MATCHED_TERMS = 2;
const MIN_MATCHED_RATIO = 0.2;

export function scoreCandidateRelevance(
  queryTerms: ReadonlySet<string>,
  candidate: { title?: string | null; snippet?: string | null; url?: string | null }
): RelevanceVerdict {
  if (queryTerms.size === 0) {
    // Nothing to compare against. Judging every result off-topic because the
    // query was one stopword would empty the run.
    return { ratio: 1, matchedTerms: 0, onTopic: true };
  }

  const haystack = topicTerms(
    `${candidate.title ?? ''} ${candidate.snippet ?? ''} ${(candidate.url ?? '').replace(/[/_-]+/g, ' ')}`
  );
  let matched = 0;
  for (const term of queryTerms) {
    if (haystack.has(term)) matched += 1;
  }
  const ratio = matched / queryTerms.size;

  // A very short query has few terms to match, so the ratio is coarse: one of
  // two terms is 0.5 and genuinely meaningful. Require one match there rather
  // than two, which would be impossible to reach honestly.
  const requiredMatches = queryTerms.size <= 3 ? 1 : MIN_MATCHED_TERMS;
  const onTopic = matched >= requiredMatches && ratio >= Math.min(MIN_MATCHED_RATIO, 1 / queryTerms.size);

  return { ratio, matchedTerms: matched, onTopic };
}

export interface RelevancePartition<T> {
  onTopic: T[];
  offTopic: T[];
}

/**
 * Split candidates into on- and off-topic, preserving input order.
 *
 * The caller ingests the on-topic set first and only reaches into the
 * off-topic set if it would otherwise fall below its minimum — starving a run
 * of sources is not an improvement on giving it the wrong ones, and a source
 * taken from the off-topic set must be recorded as such so the trace stays
 * honest about what happened.
 */
export function partitionByRelevance<T extends { title?: string | null; snippet?: string | null; url?: string | null }>(
  researchQuery: string,
  candidates: readonly T[]
): RelevancePartition<T> {
  const queryTerms = topicTerms(researchQuery);
  const onTopic: T[] = [];
  const offTopic: T[] = [];
  for (const candidate of candidates) {
    if (scoreCandidateRelevance(queryTerms, candidate).onTopic) onTopic.push(candidate);
    else offTopic.push(candidate);
  }
  return { onTopic, offTopic };
}
/**
 * The candidates discovery will actually try to ingest, in order.
 *
 * On-topic first; off-topic ONLY as far as the floor. Concatenating the whole
 * off-topic set after the on-topic one merely reordered the list, and the
 * selection loop runs until it has `maxIngest` sources — so a 40-source run
 * with three relevant results still fetched and embedded 37 the filter had
 * just classified as unrelated (Codex P1, PR #229).
 *
 * Returns the kept off-topic URLs too, so the trace can say plainly which
 * sources were used to make up a shortfall.
 */
export function selectByRelevance<T extends { title?: string | null; snippet?: string | null; url?: string | null }>(
  researchQuery: string,
  candidates: readonly T[],
  floor: number
): { ranked: T[]; toppedUpUrls: Set<string | null | undefined>; dropped: number } {
  const { onTopic, offTopic } = partitionByRelevance(researchQuery, candidates);
  const shortfall = Math.max(0, floor - onTopic.length);
  const topUp = offTopic.slice(0, shortfall);
  return {
    ranked: [...onTopic, ...topUp],
    toppedUpUrls: new Set(topUp.map((candidate) => candidate.url)),
    dropped: offTopic.length - topUp.length,
  };
}
