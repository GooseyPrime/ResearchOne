import { describe, expect, it } from 'vitest';

import {
  assessSourceSufficiency,
  buildLimitedSourcingDirective,
  sourceShortfallDegradesStatus,
} from '../services/reasoning/sourceSufficiencyGate';

/** Chunks the system discovered for itself: independent external evidence. */
function independentChunks(n: number) {
  return Array.from({ length: n }, () => ({
    source_origin: 'external_discovery' as const,
    owner_user_id: null,
  }));
}

/** Chunks the requester supplied. Context for the run, never corroboration. */
function requesterChunks(n: number, userId: string) {
  return Array.from({ length: n }, () => ({
    source_origin: 'user_upload' as const,
    owner_user_id: userId,
  }));
}

/** Something a specialist model wrote. Analysis, never evidence. */
const MODEL_WROTE_THIS = {
  story_verifier: { corroborating: [{ claim: 'a' }, { claim: 'b' }] },
  market_scout: { opportunities: [{ name: 'x' }] },
};

describe('evidence sufficiency gate', () => {
  it('routes zero-usable-data specialist output to re-discovery when another pass remains', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {
        market_scout: { opportunities: [], summary: 'none', confidence: 'low' },
        competitor_mapper: { competitors: [], gap_summary: 'none', confidence: 'low' },
        demand_signal_analyst: { signals: [], demand_summary: 'none', confidence: 'low' },
      },
      rediscoveryPassesRemaining: 1,
    });

    expect(result.action).toBe('rediscover');
    expect(result.reason).toBe('insufficient_evidence');
  });

  it('requires specialist signals independently — chunks alone do not declare evidence sufficient', () => {
    // Specialists report zero usable data points; citable chunks are present but specialist signals are zero.
    // This must not be declared sufficient (it recreates the reference failure mode).
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: independentChunks(5),
      specialistOutputs: {
        market_scout: { opportunities: [], summary: 'none', confidence: 'low' },
        competitor_mapper: { competitors: [], gap_summary: 'none', confidence: 'low' },
      },
      rediscoveryPassesRemaining: 1,
    });

    expect(result.action).toBe('rediscover');
    expect(result.action).not.toBe('sufficient');
  });

  it('builds a labeled low-evidence deliverable with the requested artifact count when rediscovery is exhausted', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: {},
      rediscoveryPassesRemaining: 0,
      requestedArtifactCount: 20,
    });

    expect(result.action).toBe('low_evidence_labeled_delivery');
    // Low-evidence mode must yield a SYNTHESIS DIRECTIVE, not a prebuilt
    // report. The previous implementation emitted 20 identical placeholder
    // sections and skipped synthesis entirely (Rule 37 R-L).
    const directive = buildLimitedSourcingDirective({
      intentId: 'opportunity_discovery',
      requestedArtifactCount: 20,
      gaps: result.gaps,
    });
    expect(directive).toContain('all 20 requested items');
    expect(directive).not.toMatch(/^## Opportunity /m);
  });

  it.each(['comparative', 'feasibility', 'recommendation', 'how_to', 'implementation'] as const)(
    'returns a synthesis directive rather than a placeholder artifact for %s',
    (intentId) => {
      const directive = buildLimitedSourcingDirective({ intentId, gaps: ['limited corroboration'] });
      expect(directive).not.toMatch(/^#\s/m);
      // Renamed from "LOW-EVIDENCE" so the directive itself stops feeding
      // adjudicative vocabulary to non-adjudicative drafters.
      expect(directive).toMatch(/LIMITED-SOURCING SYNTHESIS MODE/);
      expect(directive).toMatch(/must never be\s+a placeholder/i);
    }
  );

  it('marks insufficient-evidence runs degraded without suppressing other gates', () => {
    expect(sourceShortfallDegradesStatus('insufficient_evidence')).toBe(true);
    expect(sourceShortfallDegradesStatus('verification_failed')).toBe(false);
    expect(sourceShortfallDegradesStatus(null)).toBe(false);
  });
});

/**
 * GitHub #228 P1 — a model may not certify its own output as evidence.
 *
 * Every test here fails if `analyticalSignalCount > 0` is ever allowed to
 * satisfy the evidence condition again. That is the whole point of the file:
 * the defect was one `||` and it survived because nothing asserted against it.
 */
describe('#228 P1 — analytical coverage is not independent evidence', () => {
  it('1. story verification with zero chunks does not accept its own corroborating array', () => {
    const withPasses = assessSourceSufficiency({
      intentId: 'story_verification',
      citableChunks: [],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 1,
    });
    expect(withPasses.action).toBe('rediscover');

    const exhausted = assessSourceSufficiency({
      intentId: 'story_verification',
      citableChunks: [],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 0,
    });
    expect(exhausted.action).toBe('insufficient_evidence_fail_closed');
    expect(exhausted.action).not.toBe('sufficient');
  });

  it.each(['adjudication', 'investigation', 'position_brief'] as const)(
    '2. %s with zero chunks fails closed rather than concluding from specialist arrays',
    (intentId) => {
      const result = assessSourceSufficiency({
        intentId,
        citableChunks: [],
        specialistOutputs: MODEL_WROTE_THIS,
        rediscoveryPassesRemaining: 0,
      });
      expect(result.action).toBe('insufficient_evidence_fail_closed');
      expect(result.analyticalSignalCount).toBeGreaterThan(0);
    }
  );

  it('3. opportunity discovery with zero chunks gets a labelled full delivery, never a clean pass', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 0,
      requestedArtifactCount: 20,
    });
    expect(result.action).toBe('low_evidence_labeled_delivery');
    // And the delivery is still the whole artifact — not a placeholder, and
    // not a refusal. Rule 37 R-L.
    const directive = buildLimitedSourcingDirective({
      intentId: 'opportunity_discovery',
      requestedArtifactCount: 20,
      gaps: result.gaps,
    });
    expect(directive).toContain('all 20 requested items');
    expect(directive).not.toMatch(/^#\s/m);
  });

  it('4. sources ingested this run are not evidence until something retrieves from them', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunks: [],
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 1,
      discoverySourceCount: 12,
    });
    expect(result.action).toBe('rediscover');
    // The count still reports what the run has, so the trace stays honest.
    expect(result.usableSignalCount).toBeGreaterThan(0);
  });

  it('5. retrieved independent chunks plus usable analysis is sufficient', () => {
    const result = assessSourceSufficiency({
      intentId: 'story_verification',
      citableChunks: independentChunks(6),
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 1,
    });
    expect(result.action).toBe('sufficient');
    expect(result.independentChunkCount).toBe(6);
  });

  it('6. the requester\'s own uploads are not independent evidence for a verdict', () => {
    const owned = requesterChunks(9, 'user_abc');

    const verdict = assessSourceSufficiency({
      intentId: 'adjudication',
      citableChunks: owned,
      requesterUserId: 'user_abc',
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 0,
    });
    expect(verdict.action).toBe('insufficient_evidence_fail_closed');
    expect(verdict.independentChunkCount).toBe(0);

    // The same nine chunks are perfectly good for work that is not passing
    // judgement on a claim — "summarise what I gave you" is a real request.
    const descriptive = assessSourceSufficiency({
      intentId: 'factual_report',
      citableChunks: owned,
      requesterUserId: 'user_abc',
      specialistOutputs: MODEL_WROTE_THIS,
      rediscoveryPassesRemaining: 0,
    });
    expect(descriptive.action).toBe('sufficient');
  });

  it('does not starve an intent whose profile runs no specialists at all', () => {
    // The "specialists extracted nothing" guard must not fire when there were
    // no specialists. Otherwise every such run silently degrades.
    const result = assessSourceSufficiency({
      intentId: 'reference_lookup',
      citableChunks: independentChunks(3),
      specialistOutputs: {},
      rediscoveryPassesRemaining: 1,
    });
    expect(result.action).toBe('sufficient');
  });
});
