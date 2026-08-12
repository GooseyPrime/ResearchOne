import { describe, expect, it } from 'vitest';

import {
  assessEvidenceSufficiency,
  buildLowEvidenceLabeledDelivery,
  shouldBypassRepairLoopForEvidence,
} from '../services/reasoning/evidenceSufficiencyGate';

describe('evidence sufficiency gate', () => {
  it('routes zero-usable-data specialist output to re-discovery when another pass remains', () => {
    const result = assessEvidenceSufficiency({
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
    const result = assessEvidenceSufficiency({
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
    const result = assessEvidenceSufficiency({
      intentId: 'opportunity_discovery',
      citableChunkCount: 0,
      specialistOutputs: {},
      rediscoveryPassesRemaining: 0,
      requestedArtifactCount: 20,
    });

    expect(result.action).toBe('low_evidence_labeled_delivery');
    const markdown = buildLowEvidenceLabeledDelivery({
      intentId: 'opportunity_discovery',
      requestedArtifactCount: 20,
      gaps: result.gaps,
    });
    expect(markdown).toContain('LOW-EVIDENCE DELIVERY');
    expect((markdown.match(/^## Opportunity /gm) ?? []).length).toBe(20);
  });

  it('produces a comparative artifact structure for comparative intent low-evidence delivery', () => {
    const markdown = buildLowEvidenceLabeledDelivery({
      intentId: 'comparative',
      gaps: ['No competitor landscape recovered'],
    });
    expect(markdown).toContain('# Comparative Analysis');
    expect(markdown).toContain('LOW-EVIDENCE DELIVERY');
    expect(markdown).toContain('Comparison Dimensions');
  });

  it('produces a feasibility artifact structure for feasibility intent low-evidence delivery', () => {
    const markdown = buildLowEvidenceLabeledDelivery({
      intentId: 'feasibility',
      gaps: ['No cost/revenue data found'],
    });
    expect(markdown).toContain('# Feasibility Assessment');
    expect(markdown).toContain('INDETERMINATE');
    expect(markdown).toContain('Go/No-go: Indeterminate');
  });

  it('produces a recommendation artifact structure for recommendation intent low-evidence delivery', () => {
    const markdown = buildLowEvidenceLabeledDelivery({
      intentId: 'recommendation',
      gaps: ['No options could be ranked'],
    });
    expect(markdown).toContain('# Recommendation');
    expect(markdown).toContain('Low-confidence recommendation');
  });

  it('produces a how-to artifact structure for how_to intent low-evidence delivery', () => {
    const markdown = buildLowEvidenceLabeledDelivery({
      intentId: 'how_to',
      gaps: ['Steps could not be verified'],
    });
    expect(markdown).toContain('# How-To Guide');
    expect(markdown).toContain('Steps');
  });

  it('bypasses the repair loop for insufficient-evidence failures', () => {
    expect(shouldBypassRepairLoopForEvidence('insufficient_evidence')).toBe(true);
    expect(shouldBypassRepairLoopForEvidence('verification_failed')).toBe(false);
  });
});
