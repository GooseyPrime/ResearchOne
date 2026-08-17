import { describe, expect, it } from 'vitest';

import {
  assessSourceSufficiency,
  buildLimitedSourcingDirective,
  sourceShortfallDegradesStatus,
} from '../services/reasoning/sourceSufficiencyGate';

describe('evidence sufficiency gate', () => {
  it('routes zero-usable-data specialist output to re-discovery when another pass remains', () => {
    const result = assessSourceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
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
      citableChunkCount: 5,
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
      citableChunkCount: 0,
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
