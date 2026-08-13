import { describe, it, expect } from 'vitest';
import {
  assessEvidenceSufficiency,
  buildLowEvidenceSynthesisDirective,
} from '../services/reasoning/evidenceSufficiencyGate';
import { buildDeterministicDiscoveryQueries } from '../services/discovery/deterministicDiscoveryQueries';

/**
 * Regression suite for run 6c59b711 — "Opportunity Discovery Report" that
 * shipped twenty identical placeholder blocks, 0 sources, 0 evidence chunks,
 * and a synthesis stage that ran for 0ms because it never executed.
 */

describe('evidence sufficiency — a sealed corpus is not an evidence failure', () => {
  it('does NOT require citable corpus chunks when specialists produced signals', () => {
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
      specialistOutputs: {
        market_scout: { opportunities: [{ name: 'a' }, { name: 'b' }] },
      },
      rediscoveryPassesRemaining: 1,
      corpusIntentionallySealed: true,
    });
    // Previously: required specialistSignalCount > 0 AND citableChunkCount > 0,
    // so a deliberately sealed corpus forced every run into degraded delivery.
    expect(result.action).toBe('sufficient');
  });

  it('treats live discovery sources as usable evidence even with an empty corpus', () => {
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
      specialistOutputs: {},
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 12,
      corpusIntentionallySealed: true,
    });
    expect(result.action).toBe('sufficient');
  });

  it('still re-discovers when every evidence stream is genuinely empty', () => {
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
      specialistOutputs: { market_scout: { opportunities: [] } },
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 0,
    });
    expect(result.action).toBe('rediscover');
  });

  it('falls to labeled delivery (not refusal) once rediscovery is exhausted', () => {
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
      specialistOutputs: { market_scout: { opportunities: [] } },
      rediscoveryPassesRemaining: 0,
      discoverySourceCount: 0,
    });
    expect(result.action).toBe('low_evidence_labeled_delivery');
  });

  it('does not leak internal agent ids or corpus-gate jargon into reader-facing gaps', () => {
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
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
    const directive = buildLowEvidenceSynthesisDirective({
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
    const directive = buildLowEvidenceSynthesisDirective({
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
    const directive = buildLowEvidenceSynthesisDirective({ gaps: [] });
    expect(directive).toContain('(unverified estimate)');

    const placeholderRule = directive
      .split('\n')
      .filter((line) => /placeholder/i.test(line))
      .join(' ');
    expect(placeholderRule).not.toMatch(/"unverified"/);
    expect(directive).toMatch(/annotates real content rather than replacing it/i);
  });

  it('forbids fabricating citations while still requiring substantive content', () => {
    const directive = buildLowEvidenceSynthesisDirective({ gaps: [] });
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
