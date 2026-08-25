import { describe, expect, it } from 'vitest';
import { computeRunCost } from '../middleware/creditEnforcement';

describe('computeRunCost', () => {
  it('computes base cost for GENERAL_EPISTEMIC_RESEARCH', () => {
    const { costCents, errors } = computeRunCost('pro', 'GENERAL_EPISTEMIC_RESEARCH');
    expect(costCents).toBe(400);
    expect(errors).toHaveLength(0);
  });

  it('computes base cost for INVESTIGATIVE_SYNTHESIS', () => {
    const { costCents, errors } = computeRunCost('pro', 'INVESTIGATIVE_SYNTHESIS');
    expect(costCents).toBe(600);
    expect(errors).toHaveLength(0);
  });

  it('computes base cost for PATENT_GAP_ANALYSIS', () => {
    const { costCents, errors } = computeRunCost('pro', 'PATENT_GAP_ANALYSIS');
    expect(costCents).toBe(1000);
    expect(errors).toHaveLength(0);
  });

  it('waives surcharges for tier-included addons on sovereign', () => {
    const { costCents, addonSurchargeCents, errors } = computeRunCost(
      'sovereign',
      'GENERAL_EPISTEMIC_RESEARCH',
      ['living_reports'],
    );
    expect(errors).toHaveLength(0);
    expect(addonSurchargeCents).toBe(0);
    expect(costCents).toBe(400);
  });

  it('returns 400 error for unknown addon', () => {
    const { errors } = computeRunCost('pro', 'GENERAL_EPISTEMIC_RESEARCH', ['nonexistent_addon']);
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(400);
    expect(errors[0].addon).toBe('nonexistent_addon');
  });

  it('returns 403 error for tier-disallowed addon', () => {
    const { errors } = computeRunCost('free_demo', 'GENERAL_EPISTEMIC_RESEARCH', ['living_reports']);
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(403);
    expect(errors[0].addon).toBe('living_reports');
  });

  it('allows addon that tier has enabled', () => {
    const { costCents, errors } = computeRunCost('pro', 'GENERAL_EPISTEMIC_RESEARCH', ['smart_citations']);
    expect(errors).toHaveLength(0);
    expect(costCents).toBe(400 + 50);
  });

  it('no longer sells the challenge pass as an add-on (WO-AH)', () => {
    // "Devil's Advocate Review" was $5.00 per run for a critique pass every run
    // now gets. It is not purchasable, so it is simply an unknown key — the same
    // 400 any other unrecognised addon gets, on every tier.
    for (const tier of ['pro', 'anonymous', 'sovereign'] as const) {
      const { errors } = computeRunCost(tier, 'GENERAL_EPISTEMIC_RESEARCH', ['adversarial_twin']);
      expect(errors, tier).toHaveLength(1);
      expect(errors[0].status, tier).toBe(400);
    }
  });

  it('sovereign tier waives included addons but still surcharges parallel add-ons', () => {
    const { costCents, addonSurchargeCents, errors } = computeRunCost('sovereign', 'GENERAL_EPISTEMIC_RESEARCH', [
      'living_reports',
      'provenance_ledger',
      'parallel_search',
      'parallel_extract',
      'smart_citations',
    ]);
    expect(errors).toHaveLength(0);
    expect(addonSurchargeCents).toBe(250);
    expect(costCents).toBe(650);
  });

  it('team tier waives living_reports surcharge when livingReportsIncluded', () => {
    const { addonSurchargeCents, costCents } = computeRunCost('team', 'GENERAL_EPISTEMIC_RESEARCH', [
      'living_reports',
    ]);
    expect(addonSurchargeCents).toBe(0);
    expect(costCents).toBe(400);
  });

  it('defaults to 400 for null objective', () => {
    const { costCents } = computeRunCost('pro', null);
    expect(costCents).toBe(400);
  });
});
