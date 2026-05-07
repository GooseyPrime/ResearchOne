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

  it('adds addon costs to base', () => {
    const { costCents, errors } = computeRunCost('sovereign', 'GENERAL_EPISTEMIC_RESEARCH', [
      'living_reports', 'adversarial_twin',
    ]);
    expect(costCents).toBe(400 + 200 + 500);
    expect(errors).toHaveLength(0);
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

  it('pro tier cannot use adversarial_twin', () => {
    const { errors } = computeRunCost('pro', 'GENERAL_EPISTEMIC_RESEARCH', ['adversarial_twin']);
    expect(errors).toHaveLength(1);
    expect(errors[0].status).toBe(403);
  });

  it('sovereign tier can use all addons', () => {
    const { costCents, errors } = computeRunCost('sovereign', 'GENERAL_EPISTEMIC_RESEARCH', [
      'living_reports', 'adversarial_twin', 'provenance_ledger', 'parallel_search', 'parallel_extract', 'smart_citations',
    ]);
    expect(errors).toHaveLength(0);
    expect(costCents).toBe(400 + 200 + 500 + 300 + 100 + 100 + 50);
  });

  it('defaults to 400 for null objective', () => {
    const { costCents } = computeRunCost('pro', null);
    expect(costCents).toBe(400);
  });
});
