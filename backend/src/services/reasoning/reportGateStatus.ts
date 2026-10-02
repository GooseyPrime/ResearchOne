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

/**
 * The terminal status of a report, in the order the checks apply. Contract and
 * verifier failures come first, so an evidence shortfall cannot hide a failure
 * a redraft could repair. The fixed source count sets the status only where
 * `countSetsStatus` is true: on a Layer 1 run it is recorded and nothing more.
 */
export function decideReportGateStatus(args: {
  contractFailed: boolean;
  verifierFailed: boolean;
  /** The count-based evidence check asks for a downgrade and the material judge did not overrule it. */
  evidenceShortfallDegrades: boolean;
  /** Fewer usable sources than the confirmed plan asked for. */
  sourceCoverageShortfall: boolean;
  /** Whether that shortfall may set the status (false on a Layer 1 run). */
  countSetsStatus: boolean;
}): { status: ReportGateStatus; countShortfallApplied: boolean } {
  if (args.contractFailed) return { status: 'contract_failed', countShortfallApplied: false };
  if (args.verifierFailed) return { status: 'verification_failed', countShortfallApplied: false };
  if (args.evidenceShortfallDegrades) return { status: 'completed_degraded', countShortfallApplied: false };
  if (args.countSetsStatus && args.sourceCoverageShortfall) return { status: 'completed_degraded', countShortfallApplied: true };
  return { status: 'completed', countShortfallApplied: false };
}
