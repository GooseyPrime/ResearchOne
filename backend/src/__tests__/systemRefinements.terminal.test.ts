import { describe, expect, it } from 'vitest';

import { mapGateStatusToRunStatus } from '../services/reasoning/reportGateStatus';

type VerificationStatus = 'PASS' | 'FAIL';

type VerificationResult = {
  passed: boolean;
  criteria: Array<{ criterion: string; status: VerificationStatus; note: string }>;
  overall: string;
};

function normalizeVerificationResult(result: VerificationResult | null): VerificationResult {
  if (!result) return { passed: false, criteria: [], overall: 'PARSE_FAILED' };
  const overall = typeof result.overall === 'string' ? result.overall : 'UNKNOWN';
  const criteria = Array.isArray(result.criteria) ? result.criteria : [];
  const passed = overall === 'PASS' && criteria.length > 0 && result.passed !== false;
  return { passed, criteria, overall };
}

function terminalEventTypeForGateStatus(status: 'completed' | 'completed_degraded' | 'contract_failed' | 'verification_failed') {
  return mapGateStatusToRunStatus(status) === 'completed' ? 'run_completed' : 'run_quality_gate_failed';
}

describe('system refinements terminal gating', () => {
  it('maps completed gate status to completed run status', () => {
    expect(mapGateStatusToRunStatus('completed')).toBe('completed');
  });

  it('maps verification_failed gate status to failed run status', () => {
    expect(mapGateStatusToRunStatus('verification_failed')).toBe('failed');
  });

  it('maps contract_failed gate status to failed run status', () => {
    expect(mapGateStatusToRunStatus('contract_failed')).toBe('failed');
  });

  it('maps completed_degraded gate status to failed run status', () => {
    expect(mapGateStatusToRunStatus('completed_degraded')).toBe('failed');
  });

  it('emits run_completed only for genuinely completed gates', () => {
    expect(terminalEventTypeForGateStatus('completed')).toBe('run_completed');
  });

  it('does not emit run_completed for failed gates', () => {
    expect(terminalEventTypeForGateStatus('verification_failed')).not.toBe('run_completed');
    expect(terminalEventTypeForGateStatus('contract_failed')).not.toBe('run_completed');
    expect(terminalEventTypeForGateStatus('completed_degraded')).not.toBe('run_completed');
  });

  it('emits run_quality_gate_failed for failed gates', () => {
    expect(terminalEventTypeForGateStatus('verification_failed')).toBe('run_quality_gate_failed');
    expect(terminalEventTypeForGateStatus('contract_failed')).toBe('run_quality_gate_failed');
    expect(terminalEventTypeForGateStatus('completed_degraded')).toBe('run_quality_gate_failed');
  });

  it('treats UNKNOWN verifier overall as failed', () => {
    const result = normalizeVerificationResult({
      passed: true,
      overall: 'UNKNOWN',
      criteria: [{ criterion: 'schema', status: 'PASS', note: 'present' }],
    });

    expect(result.passed).toBe(false);
    expect(result.overall).toBe('UNKNOWN');
  });

  it('treats PARSE_FAILED verifier overall as failed', () => {
    const result = normalizeVerificationResult(null);

    expect(result.passed).toBe(false);
    expect(result.overall).toBe('PARSE_FAILED');
  });

  it('requires verification.overall PASS to succeed', () => {
    const result = normalizeVerificationResult({
      passed: true,
      overall: 'FAIL',
      criteria: [{ criterion: 'citations', status: 'FAIL', note: 'missing visible urls' }],
    });

    expect(result.passed).toBe(false);
  });
});
