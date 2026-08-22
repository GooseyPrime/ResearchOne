export type ReportGateStatus = 'completed' | 'completed_degraded' | 'contract_failed' | 'verification_failed' | 'no_evidence';

export function mapGateStatusToRunStatus(status: ReportGateStatus): 'completed' | 'failed' {
  return status === 'completed' ? 'completed' : 'failed';
}

export function mapGateStatusToReportRowStatus(status: ReportGateStatus): 'finalized' | 'under_review' {
  return status === 'completed' ? 'finalized' : 'under_review';
}

export function shouldRunPipelineBFromGateStatus(status: ReportGateStatus): boolean {
  return status === 'completed';
}
