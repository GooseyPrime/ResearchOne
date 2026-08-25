import { describe, it, expect } from 'vitest';
import {
  assessSourceSufficiency,
  buildLimitedSourcingDirective,
} from '../services/reasoning/sourceSufficiencyGate';
import { buildDeterministicDiscoveryQueries } from '../services/discovery/deterministicDiscoveryQueries';


/** Chunks the system discovered for itself: independent external evidence. */
function independentChunks(n: number): Array<{ source_origin: string; owner_user_id: null }> {
  return Array.from({ length: n }, () => ({
    source_origin: 'external_discovery',
    owner_user_id: null,
  }));
}

/**
 * Regression suite for run 6c59b711 — "Opportunity Discovery Report" that
 * shipped twenty identical placeholder blocks, 0 sources, 0 evidence chunks,
 * and a synthesis stage that ran for 0ms because it never executed.
 */

describe('evidence sufficiency — a sealed corpus is not an evidence failure', () => {
  // This assertion used to read `expect(result.action).toBe('sufficient')`,
  // and that was the defect in GitHub #228 P1 written down as a requirement:
  // two arrays produced by a model, with nothing retrieved at all, declared
  // the run's evidence sufficient. A model certifying its own output.
  //
  // The requirement the old test was protecting — a sealed corpus must not
  // force refusal — is real and is unchanged. It is met by the branch below:
  // this run rediscovers, and if that finds nothing it still delivers the
  // full artifact with an honest label. It never refuses.
  it('does not let specialist output alone certify a run as evidenced', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {
        market_scout: { opportunities: [{ name: 'a' }, { name: 'b' }] },
      },
      rediscoveryPassesRemaining: 1,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('rediscover');
    expect(result.analyticalSignalCount).toBe(2);
    expect(result.independentChunkCount).toBe(0);
  });

  it('still delivers rather than refusing when a sealed corpus yields nothing', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {
        market_scout: { opportunities: [{ name: 'a' }, { name: 'b' }] },
      },
      rediscoveryPassesRemaining: 0,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('low_evidence_labeled_delivery');
  });

  // This case previously asserted 'sufficient', and that assertion described
  // the defect rather than the requirement. Runs 0eee6032 and 243995b4 landed
  // here: discovery reported sources, retrieval returned zero chunks, the gate
  // said 'sufficient', and synthesis produced a report with no citations that
  // was reported as complete. Sources INGESTED are not evidence RETRIEVED.
  //
  // The requirement it was protecting — a sealed corpus must not force refusal
  // — is unchanged and covered below: this run rediscovers, then delivers with
  // a low-evidence label. It never refuses.
  it('does not call discovery sources sufficient when none of them retrieved', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {},
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 12,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('rediscover');
  });

  it('delivers with a label, never refuses, when discovery retrieved nothing twice', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {},
      rediscoveryPassesRemaining: 0,
      discoverySourceCount: 12,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('low_evidence_labeled_delivery');
  });

  it('is sufficient as soon as discovery sources actually yield chunks', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: independentChunks(8),
      specialistOutputs: {},
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 12,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('sufficient');
  });

  it('still hard-fails an adjudicative intent with no evidence after rediscovery', () => {
    const result = assessSourceSufficiency({
      intentId: 'adjudication',
      citableChunks: [],
      specialistOutputs: {},
      rediscoveryPassesRemaining: 0,
      discoverySourceCount: 12,
      corpusIntentionallySealed: true,
    });
    // Renamed from 'rediscover': "go round again" and "stop, there is nothing
    // here to conclude from" used to be the same value, told apart only by a
    // counter held somewhere else.
    expect(result.action).toBe('insufficient_evidence_fail_closed');
  });

  it('still re-discovers when every evidence stream is genuinely empty', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: { market_scout: { opportunities: [] } },
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 0,
    });
    expect(result.action).toBe('rediscover');
  });

  it('falls to labeled delivery (not refusal) once rediscovery is exhausted', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: { market_scout: { opportunities: [] } },
      rediscoveryPassesRemaining: 0,
      discoverySourceCount: 0,
    });
    expect(result.action).toBe('low_evidence_labeled_delivery');
  });

  it('does not leak internal agent ids or corpus-gate jargon into reader-facing gaps', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: { market_scout: { opportunities: [] }, competitor_mapper: { competitors: [] } },
      rediscoveryPassesRemaining: 0,
      corpusIntentionallySealed: true,
    });
    const joined = result.gaps.join('\n');
    expect(joined).not.toContain('market_scout');
    expect(joined).not.toContain('competitor_mapper');
    expect(joined).not.toContain('competence gate');
  });
});

describe('low-evidence mode is a synthesis modifier, never a report', () => {
  it('returns a prompt directive, not markdown headings', () => {
    const directive = buildLimitedSourcingDirective({
      intentId: 'opportunity_discovery',
      requestedArtifactCount: 20,
      gaps: ['Competitive landscape was not independently mapped this run.'],
    });
    // The old implementation returned a full markdown report body.
    expect(directive).not.toMatch(/^#\s/m);
    expect(directive).not.toContain('## Opportunity 1');
    expect(directive).not.toContain('LOW-EVIDENCE DELIVERY —');
  });

  it('instructs the model to produce every requested item in full', () => {
    const directive = buildLimitedSourcingDirective({
      intentId: 'opportunity_discovery',
      requestedArtifactCount: 20,
      gaps: [],
    });
    expect(directive).toContain('all 20 requested items');
    expect(directive).toMatch(/must never be\s+a placeholder/i);
    expect(directive).toMatch(/do not refuse/i);
  });

  it('does not ban the "(unverified estimate)" marker it later requires', () => {
    // Copilot review, PR #202: the placeholder rule previously listed
    // "unverified" as forbidden text while a later bullet mandated the
    // "(unverified estimate)" marker — an internal contradiction that could
    // make the drafter avoid the intended marker.
    const directive = buildLimitedSourcingDirective({ gaps: [] });
    expect(directive).toContain('(unverified estimate)');

    const placeholderRule = directive
      .split('\n')
      .filter((line) => /placeholder/i.test(line))
      .join(' ');
    expect(placeholderRule).not.toMatch(/"unverified"/);
    expect(directive).toMatch(/annotates real content rather than replacing it/i);
  });

  it('forbids fabricating citations while still requiring substantive content', () => {
    const directive = buildLimitedSourcingDirective({ gaps: [] });
    expect(directive).toMatch(/do not fabricate/i);
    expect(directive).toMatch(/complete requested deliverable/i);
  });
});

describe('deterministic discovery queries — discovery can never be silently zeroed', () => {
  const researchQuery = `# Research Objective: Identify and Rank the 20 Best Affiliate Comparison-Site Opportunities for a Zero-Additional-Cost AI Publishing Business

Conduct an evidence-driven **Opportunity Discovery** study to identify, evaluate, score, and rank exactly **20 market verticals** suitable for building an AI-assisted comparison and affiliate-content business.`;

  it('derives usable queries when the discovery planner returns nothing', () => {
    const queries = buildDeterministicDiscoveryQueries(researchQuery, undefined);
    expect(queries.length).toBeGreaterThan(0);
    expect(queries.join(' ').toLowerCase()).toContain('affiliate');
  });

  it('prefers retrieval queries already on the confirmed plan', () => {
    const queries = buildDeterministicDiscoveryQueries(researchQuery, {
      retrieval_queries: ['affiliate network commission rates 2026'],
    });
    expect(queries[0]).toBe('affiliate network commission rates 2026');
  });

  it('never emits an unusable query built from the entire prompt', () => {
    const queries = buildDeterministicDiscoveryQueries(researchQuery, {
      retrieval_queries: [researchQuery],
    });
    for (const q of queries) {
      expect(q.length).toBeLessThanOrEqual(180);
      expect(q.length).toBeGreaterThanOrEqual(8);
    }
  });

  it('returns an empty list for input with no salient content', () => {
    expect(buildDeterministicDiscoveryQueries('   ', undefined)).toEqual([]);
  });
});
