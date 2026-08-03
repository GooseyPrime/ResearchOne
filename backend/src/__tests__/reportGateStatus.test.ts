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
