import { describe, expect, it } from 'vitest';

import {
  mapGateStatusToReportRowStatus,
  mapGateStatusToRunStatus,
  shouldRunPipelineBFromGateStatus,
  type ReportGateStatus,
} from '../services/reasoning/reportGateStatus';

describe('reportGateStatus', () => {
  const nonPassing: ReportGateStatus[] = ['completed_degraded', 'contract_failed', 'verification_failed'];

  it('maps gate status to valid research run status values', () => {
    expect(mapGateStatusToRunStatus('completed')).toBe('completed');
    for (const status of nonPassing) {
      expect(mapGateStatusToRunStatus(status)).toBe('failed');
    }
  });

  it('keeps non-passing reports under review and blocks Pipeline B ingestion', () => {
    expect(mapGateStatusToReportRowStatus('completed')).toBe('finalized');
    expect(shouldRunPipelineBFromGateStatus('completed')).toBe(true);
    for (const status of nonPassing) {
      expect(mapGateStatusToReportRowStatus(status)).toBe('under_review');
      expect(shouldRunPipelineBFromGateStatus(status)).toBe(false);
    }
  });
});

describe('terminal status and the fixed source count', () => {
  const base = { contractFailed: false, verifierFailed: false, evidenceShortfallDegrades: false, sourceCoverageShortfall: true };

  it('downgrades a switch-off run that read fewer sources than planned', async () => {
    const { decideReportGateStatus } = await import('../services/reasoning/reportGateStatus');
    const { countShortfallSetsStatus } = await import('../services/reasoning/citationLock');
    expect(decideReportGateStatus({ ...base, countSetsStatus: countShortfallSetsStatus(false) })).toEqual({
      status: 'completed_degraded',
      countShortfallApplied: true,
    });
  });

  it('completes a Layer 1 run with the same shortfall, leaving verification and the contract to decide', async () => {
    const { decideReportGateStatus } = await import('../services/reasoning/reportGateStatus');
    const { countShortfallSetsStatus } = await import('../services/reasoning/citationLock');
    const countSetsStatus = countShortfallSetsStatus(true);
    expect(decideReportGateStatus({ ...base, countSetsStatus })).toEqual({ status: 'completed', countShortfallApplied: false });
    expect(decideReportGateStatus({ ...base, countSetsStatus, verifierFailed: true }).status).toBe('verification_failed');
    expect(decideReportGateStatus({ ...base, countSetsStatus, contractFailed: true }).status).toBe('contract_failed');
    expect(decideReportGateStatus({ ...base, countSetsStatus, evidenceShortfallDegrades: true }).status).toBe('completed_degraded');
  });

  it('applies the count after contract and verifier failures, never before', async () => {
    const { decideReportGateStatus } = await import('../services/reasoning/reportGateStatus');
    expect(decideReportGateStatus({ ...base, countSetsStatus: true, contractFailed: true, verifierFailed: true })).toEqual({
      status: 'contract_failed',
      countShortfallApplied: false,
    });
    expect(decideReportGateStatus({ ...base, countSetsStatus: true, verifierFailed: true }).countShortfallApplied).toBe(false);
  });

  it('is the rule the research job applies', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/reasoning/researchOrchestrator.ts', 'utf8');
    expect(source).toMatch(/const decided = decideReportGateStatus\(\{[\s\S]{0,400}countSetsStatus: countShortfallSetsStatus\(layer1Run\)/);
    expect(source).toMatch(/const nextStatus: ReportGateStatus = decided\.status;/);
  });
});
