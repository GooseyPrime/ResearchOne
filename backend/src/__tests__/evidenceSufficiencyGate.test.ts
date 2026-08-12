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

  it('bypasses the repair loop for insufficient-evidence failures', () => {
    expect(shouldBypassRepairLoopForEvidence('insufficient_evidence')).toBe(true);
    expect(shouldBypassRepairLoopForEvidence('verification_failed')).toBe(false);
  });
});
