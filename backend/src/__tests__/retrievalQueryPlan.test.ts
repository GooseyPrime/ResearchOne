import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_QUERY_MAX_CHARS,
  TOPIC_SEED_MAX_CHARS,
  composeRetrievalQuery,
  deriveTopicSeed,
  enforceRetrievalQueryBudget,
  normalizeQueryText,
  queriesAreTooSimilar,
  querySpecificity,
  tokenOverlapRatio,
} from '../services/reasoning/retrievalQueryPlan';

/**
 * Built from run b8265303, where five retrieval queries returned the work of
 * one: queries 2, 3 and 4 added no chunks the first had not already found, and
 * nine freshly ingested sources yielded citations from two.
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
    expect(
      deriveTopicSeed('# Research Objective: Rank affiliate comparison-site verticals\n\nLong preamble follows.')
    ).toBe('Rank affiliate comparison-site verticals');
  });

  it('never ends mid-word', () => {
    const seed = deriveTopicSeed('a '.repeat(200) + 'terminalword');
    expect(seed.endsWith(' ')).toBe(false);
  });

  it('survives an empty objective', () => {
    expect(deriveTopicSeed('')).toBe('');
  });
});

describe('deriveTopicSeed: abbreviations are not sentence ends', () => {
  // For a confirmed brief with no artifacts or constraints the seed is the ONLY
  // retrieval query, so a fragment here makes the whole run search for the
  // wrong thing. The first version of this test put the period before the
  // 24-character cutoff and so passed through a different branch than the
  // defect (Codex, #221) — hence the late-period cases below.
  it('keeps a late U.S. inside the sentence', () => {
    expect(
      deriveTopicSeed('Assess healthcare access policies across the U.S. and Canada. Rank them.')
    ).toBe('Assess healthcare access policies across the U.S. and Canada');
  });

  it('handles U.K. and Ph.D. equally', () => {
    expect(deriveTopicSeed('Compare graduate funding models in the U.K. and Germany today.')).toBe(
      'Compare graduate funding models in the U.K. and Germany today'
    );
    expect(
      deriveTopicSeed('Survey the employment outcomes of Ph.D. graduates in the life sciences.')
    ).toBe('Survey the employment outcomes of Ph.D. graduates in the life sciences');
  });

  it('handles a title and an example mid-sentence', () => {
    expect(deriveTopicSeed("Summarise Dr. Kahneman's work on decision heuristics. Then rank it.")).toBe(
      "Summarise Dr. Kahneman's work on decision heuristics"
    );
    expect(
      deriveTopicSeed('Evaluate vector databases, e.g. pgvector and Qdrant, for hybrid search. Rank them.')
    ).toBe('Evaluate vector databases, e.g. pgvector and Qdrant, for hybrid search');
  });

  it('still finds a genuine sentence end', () => {
    expect(deriveTopicSeed('Rank six RAG evaluation methods. Then compare them.')).toBe(
      'Rank six RAG evaluation methods'
    );
  });
});

describe('normalizeQueryText', () => {
  it('collapses whitespace runs, including newlines and tabs', () => {
    expect(normalizeQueryText('  RAG   evaluation\n\tmethods  ')).toBe('RAG evaluation methods');
  });

  it('survives empty input', () => {
    expect(normalizeQueryText('')).toBe('');
  });
});

describe('composeRetrievalQuery', () => {
  const seed = deriveTopicSeed(LIVE_OBJECTIVE);

  it('returns a clause as written', () => {
    // Appending the topic to every clause is what created the redundancy this
    // module exists to prevent, so nothing is appended to a usable clause —
    // including a long generic one, which keeps its own words rather than
    // acquiring a shared suffix.
    for (const clause of LIVE_CLAUSES) {
      expect(composeRetrievalQuery(clause, seed)).toBe(clause);
    }
    const generic = 'Provide a comparison table covering prices, features, integrations, support, and risks';
    expect(composeRetrievalQuery(generic, seed)).toBe(generic);
  });

  it('gives the topic to a clause too thin to retrieve on', () => {
    const q = composeRetrievalQuery('security requirements', seed);
    expect(q.startsWith('security requirements')).toBe(true);
    expect(q).toContain(seed);
  });

  it('falls back to whichever half it has', () => {
    expect(composeRetrievalQuery('', 'topic only')).toBe('topic only');
    expect(composeRetrievalQuery('clause only text here', '')).toBe('clause only text here');
  });
});

describe('queriesAreTooSimilar', () => {
  it('catches the shared-preamble shape that shipped', () => {
    const oldSeed = LIVE_OBJECTIVE.slice(0, 200);
    expect(queriesAreTooSimilar(`${oldSeed} ${LIVE_CLAUSES[0]}`, `${oldSeed} ${LIVE_CLAUSES[1]}`)).toBe(true);
  });

  it('catches shared text in the suffix as readily as the prefix', () => {
    const anchor =
      'Identify exactly 6 distinct methods used to evaluate retrieval-augmented generation RAG systems';
    expect(queriesAreTooSimilar(`Table A ${anchor}`, `Table B ${anchor}`)).toBe(true);
  });

  it('accepts the brief clauses, which are what actually go out', () => {
    for (let i = 0; i < LIVE_CLAUSES.length; i += 1) {
      for (let j = i + 1; j < LIVE_CLAUSES.length; j += 1) {
        expect(queriesAreTooSimilar(LIVE_CLAUSES[i]!, LIVE_CLAUSES[j]!)).toBe(false);
      }
    }
  });

  it('does not fire on a short coincidental overlap', () => {
    expect(queriesAreTooSimilar('How do embeddings drift', 'How does chunking affect recall')).toBe(false);
  });
});

describe('overlap is measured for non-Latin scripts too', () => {
  const chineseAnchor = '检索增强生成系统的评估方法与其失效模式的比较研究';

  it('tokenizes an unspaced script into more than one token', () => {
    // The whole Chinese run arrives from the whitespace split as ONE token.
    // The earlier version returned early on that, so the bigram fallback never
    // ran and every Chinese pair scored 1.0 or 0.0 with nothing between — the
    // tests passed for the wrong reason (Codex, #221).
    expect(querySpecificity(chineseAnchor)).toBeGreaterThan(5);
  });

  it('scores partial overlap between related Chinese queries', () => {
    const ratio = tokenOverlapRatio('检索增强生成系统的评估方法', '检索增强生成系统的失效模式');
    expect(ratio).toBeGreaterThan(0);
    expect(ratio).toBeLessThan(1);
  });

  it('catches two Chinese queries sharing the same long anchor', () => {
    expect(queriesAreTooSimilar(`表A ${chineseAnchor}`, `表B ${chineseAnchor}`)).toBe(true);
  });

  it('still separates genuinely different Chinese queries', () => {
    expect(queriesAreTooSimilar('机器学习模型的训练成本分析', '海洋酸化对珊瑚礁的长期影响')).toBe(false);
  });

  it('tokenizes each script in a mixed-script query', () => {
    const tokens = querySpecificity('retrieval augmented generation 检索增强生成系统');
    // Latin words plus Chinese bigrams, not one or the other.
    expect(tokens).toBeGreaterThan(6);
  });

  it('scores a Cyrillic pair rather than returning zero', () => {
    expect(tokenOverlapRatio('оценка систем поиска', 'оценка систем поиска')).toBe(1);
  });
});

describe('tokenOverlapRatio', () => {
  it('is symmetric and bounded', () => {
    const a = 'alpha beta gamma delta';
    const b = 'gamma delta epsilon zeta';
    expect(tokenOverlapRatio(a, b)).toBeCloseTo(tokenOverlapRatio(b, a));
    expect(tokenOverlapRatio(a, a)).toBe(1);
    expect(tokenOverlapRatio('', 'anything here')).toBe(0);
  });
});

describe('enforceRetrievalQueryBudget', () => {
  const seed = deriveTopicSeed(LIVE_OBJECTIVE);
  const liveQueries = [seed, ...LIVE_CLAUSES.map((c) => composeRetrievalQuery(c, seed))];

  it('keeps every query the fixed construction produces', () => {
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: liveQueries,
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.warnings).toEqual([]);
    expect(result.queries).toHaveLength(liveQueries.length);
  });

  it('collapses the shape that shipped down to one query', () => {
    // The old fixed 320-char threshold sat above the 200-char seed, so a
    // prefix shared by construction could never reach it.
    const oldSeed = LIVE_OBJECTIVE.slice(0, 200);
    const shipped = LIVE_CLAUSES.map((c) => `${oldSeed} ${c}`);

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: shipped,
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: oldSeed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toHaveLength(1);
    expect(result.warnings.join(' ')).toMatch(/dropped 3 planner retrieval queries/);
  });

  it('dedupes queries differing only by internal whitespace', () => {
    const base = LIVE_CLAUSES[0]!;
    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [base, base.replace(/ /g, '  '), `\n  ${base}\t`],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toEqual([base]);
    expect(result.warnings).toEqual([]);
  });

  it('keeps the more specific query when two overlap', () => {
    // The bare seed is inserted first, so keeping the EARLIER member kept the
    // broad seed and discarded the enriched query, leaving the distinguishing
    // angle unsearched (Codex, #221).
    const topic = 'Evaluate the security posture of a multi-tenant healthcare scheduling platform';
    const enriched = composeRetrievalQuery('security requirements', topic);

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [topic, enriched],
      subQuestions: ['security requirements'],
      fallbackQuery: topic,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toEqual([enriched]);
    expect(querySpecificity(result.queries[0]!)).toBeGreaterThan(querySpecificity(topic));
  });

  it('keeps unrelated angles when only one pair overlaps', () => {
    const a = LIVE_CLAUSES[0]!;
    const nearDuplicate = `${a} please`;
    const distinct = 'RAGAS benchmark reliability across clinical corpora';

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [a, nearDuplicate, distinct],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toContain(distinct);
    expect(result.queries).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/dropped 1 planner retrieval query/);
  });

  it('removes every rival a more specific query supersedes', () => {
    // A later query can overlap several retained ones at once. Replacing only
    // the first left the others standing, redundant against the replacement
    // and never rechecked (Codex, #221).
    const a = 'alpha beta gamma delta theta';
    const b = 'alpha beta gamma epsilon zeta';
    const union = 'alpha beta gamma delta theta epsilon zeta';

    expect(queriesAreTooSimilar(a, b)).toBe(false); // a and b are distinct
    expect(queriesAreTooSimilar(a, union)).toBe(true);
    expect(queriesAreTooSimilar(b, union)).toBe(true);

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [a, b, union],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toEqual([union]);
    expect(result.warnings.join(' ')).toMatch(/dropped 2 planner retrieval queries/);
  });

  it('keeps the retained pair when the newcomer supersedes only one of them', () => {
    const a = 'alpha beta gamma delta theta';
    const b = 'alpha beta gamma epsilon zeta';
    const partial = 'alpha beta gamma delta theta iota';

    const result = enforceRetrievalQueryBudget({
      retrievalQueries: [a, b, partial],
      subQuestions: LIVE_CLAUSES,
      fallbackQuery: seed,
      maxChars: RETRIEVAL_QUERY_MAX_CHARS,
    });

    expect(result.queries).toContain(b);
    expect(result.queries).toHaveLength(2);
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
