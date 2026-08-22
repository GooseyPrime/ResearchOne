import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_QUERY_MAX_CHARS,
  TOPIC_SEED_MAX_CHARS,
  composeRetrievalQuery,
  deriveTopicSeed,
  enforceRetrievalQueryBudget,
  queriesAreTooSimilar,
} from '../services/reasoning/retrievalQueryPlan';

/**
 * Built from run b8265303, where five retrieval queries returned the work of
 * one: queries 2, 3 and 4 added no chunks the first had not already found, and
 * a corpus of nine freshly ingested sources yielded citations from two.
 */
const LIVE_OBJECTIVE =
  'Identify exactly 6 distinct methods used to evaluate retrieval-augmented generation (RAG) ' +
  'systems. For each method, give a comparison table covering what it measures, its known ' +
  'failure modes, and the published evidence supporting it. Rank the six by how well they ' +
  'detect unsupported generated claims.';

const LIVE_CLAUSES = [
  'Six distinct RAG evaluation methods, each presented with a comparison table',
  'Ranking of the six methods ordered by effectiveness at detecting unsupported generated claims',
  'Must identify exactly six distinct methods',
  "Each method's comparison table must cover: what it measures, known failure modes, and published evidence",
];

describe('deriveTopicSeed', () => {
  it('takes the first sentence of a one-paragraph objective, not a truncation of it', () => {
    const seed = deriveTopicSeed(LIVE_OBJECTIVE);

    // What shipped: the first 200 characters, ending mid-clause on "and the".
    expect(seed).not.toMatch(/and the$/);
    expect(seed).toBe(
      'Identify exactly 6 distinct methods used to evaluate retrieval-augmented generation (RAG) systems'
    );
  });

  it('stays within the anchor budget', () => {
    expect(deriveTopicSeed(LIVE_OBJECTIVE).length).toBeLessThanOrEqual(TOPIC_SEED_MAX_CHARS + 1);
  });

  it('prefers an explicitly labelled objective line', () => {
    const seed = deriveTopicSeed('# Research Objective: Rank affiliate comparison-site verticals\n\nLong preamble follows.');
    expect(seed).toBe('Rank affiliate comparison-site verticals');
  });

  it('never ends mid-word', () => {
    const seed = deriveTopicSeed('a '.repeat(200) + 'terminalword');
    expect(seed.endsWith(' ')).toBe(false);
    expect(seed).not.toMatch(/\bterminalwo$/);
  });

  it('survives an empty objective', () => {
    expect(deriveTopicSeed('')).toBe('');
  });
});

describe('composeRetrievalQuery', () => {
  it('puts the distinguishing clause first so it dominates the embedding', () => {
    const seed = deriveTopicSeed(LIVE_OBJECTIVE);
    const q = composeRetrievalQuery(LIVE_CLAUSES[0]!, seed);
    expect(q.startsWith(LIVE_CLAUSES[0]!)).toBe(true);
  });

  it('omits the anchor when the clause already carries the topic', () => {
    const q = composeRetrievalQuery('RAG evaluation methods compared', 'RAG evaluation methods');
    expect(q).toBe('RAG evaluation methods compared');
  });

  it('falls back to whichever half it has', () => {
    expect(composeRetrievalQuery('', 'topic only')).toBe('topic only');
    expect(composeRetrievalQuery('clause only', '')).toBe('clause only');
  });
});

describe('queriesAreTooSimilar', () => {
  it('catches the shared-preamble shape that shipped', () => {
    const oldSeed = LIVE_OBJECTIVE.slice(0, 200);
    expect(queriesAreTooSimilar(`${oldSeed} ${LIVE_CLAUSES[0]}`, `${oldSeed} ${LIVE_CLAUSES[1]}`)).toBe(true);
  });

  it('does not fire on a short coincidental overlap', () => {
    expect(queriesAreTooSimilar('How do embeddings drift', 'How does chunking affect recall')).toBe(false);
  });

  it('accepts genuinely distinct queries', () => {
    const seed = deriveTopicSeed(LIVE_OBJECTIVE);
    const a = composeRetrievalQuery(LIVE_CLAUSES[0]!, seed);
    const b = composeRetrievalQuery(LIVE_CLAUSES[1]!, seed);
    expect(queriesAreTooSimilar(a, b)).toBe(false);
  });
});

describe('enforceRetrievalQueryBudget', () => {
  const seed = deriveTopicSeed(LIVE_OBJECTIVE);
  const liveQueries = [seed, ...LIVE_CLAUSES.map((c) => composeRetrievalQuery(c, seed))];

  it('passes the queries the fixed construction now produces', () => {
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: liveQueries,
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.warnings).toEqual([]);
    expect(result.queries).toHaveLength(liveQueries.length);
  });

  it('rejects the shape that shipped, which the old fixed threshold could not', () => {
    // The seed was capped at 200 chars and the guard fired above 320, so a
    // prefix shared by construction could never reach the limit.
    const oldSeed = LIVE_OBJECTIVE.slice(0, 200);
    const shipped = LIVE_CLAUSES.map((c) => `${oldSeed} ${c}`);

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: shipped,
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: oldSeed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.warnings.join(' ')).toMatch(/overlapped by more than/);
    expect(result.queries).toEqual(LIVE_CLAUSES);
  });

  it('truncates an over-long query and says so', () => {
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: ['x'.repeat(RETRIEVAL_QUERY_MAX_CHARS + 50)],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });
    expect(result.warnings.join(' ')).toMatch(/exceeded/);
    expect(result.queries[0]!.length).toBe(RETRIEVAL_QUERY_MAX_CHARS);
  });

  it('falls back to the sub-questions when nothing usable is planned', () => {
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: ['', '   '],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });
    expect(result.queries).toEqual(LIVE_CLAUSES);
  });

  it('strips Qn: labels from deterministic fallback queries', () => {
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [],
      subQuestions: ['Q1: first angle', 'Q2: second angle'],
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });
    expect(result.queries).toEqual(['first angle', 'second angle']);
  });
});
