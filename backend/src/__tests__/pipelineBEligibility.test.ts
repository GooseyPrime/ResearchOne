import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryOneMock = vi.fn();

vi.mock('../db/pool', () => ({
  get queryOne() { return queryOneMock; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../config/deployment', () => ({
  isSovereignDeployment: false,
  DEPLOYMENT_MODE: 'b2c_shared',
  EXCLUDE_INTELLME_CLIENT: false,
}));

import { evaluatePipelineBEligibility } from '../services/ingestion/pipelineBEligibility';

describe('pipelineBEligibility', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('eligible when all conditions met', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: true });
    queryOneMock.mockResolvedValueOnce(null);
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'pro', 'completed');
    expect(result.eligible).toBe(true);
    expect(result.reasons).toHaveLength(0);
  });

  it('ineligible when run not completed', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: true });
    queryOneMock.mockResolvedValueOnce(null);
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'pro', 'failed');
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('run_not_completed');
  });

  it('ineligible when user tier is sovereign (defense layer 1)', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: true });
    queryOneMock.mockResolvedValueOnce(null);
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'sovereign', 'completed');
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('sovereign_tier');
  });

  it('ineligible when user opted out of pipeline B', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: false });
    queryOneMock.mockResolvedValueOnce(null);
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'pro', 'completed');
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('user_opted_out');
  });

  it('ineligible when per-run opt-out set', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: true });
    queryOneMock.mockResolvedValueOnce({ pipeline_b_opt_out: true });
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'pro', 'completed');
    expect(result.eligible).toBe(false);
    expect(result.reasons).toContain('per_run_opt_out');
  });

  it('eligible when consent table does not exist (42P01 tolerance)', async () => {
    queryOneMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
    queryOneMock.mockResolvedValueOnce(null);
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'pro', 'completed');
    expect(result.eligible).toBe(true);
  });

  it('accumulates multiple ineligibility reasons', async () => {
    queryOneMock.mockResolvedValueOnce({ pipeline_b_consent: false });
    queryOneMock.mockResolvedValueOnce({ pipeline_b_opt_out: true });
    const result = await evaluatePipelineBEligibility('run1', 'u1', 'sovereign', 'failed');
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});
