import { retentionConfig, RetentionConfig } from '../../config/retention';
import { queryOne } from '../../db/pool';

export interface ReportExpiryResult {
  reportExpiresAt: Date;
  workspaceExpiresAt: Date;
}

export function computeReportExpiry(
  finalizedAt: Date,
  cfg: RetentionConfig = retentionConfig,
): ReportExpiryResult {
  const reportExpiresAt = new Date(finalizedAt.getTime() + cfg.reportRetentionDays * 24 * 60 * 60 * 1000);
  const workspaceExpiresAt = new Date(finalizedAt.getTime() + cfg.finalizedWorkspaceDays * 24 * 60 * 60 * 1000);
  return { reportExpiresAt, workspaceExpiresAt };
}

export function computeWorkspaceExpiry(
  terminalAt: Date,
  status: string,
  cfg: RetentionConfig = retentionConfig,
): Date {
  const days = (status === 'failed' || status === 'cancelled' || status === 'aborted')
    ? cfg.failedRunDays
    : cfg.finalizedWorkspaceDays;
  return new Date(terminalAt.getTime() + days * 24 * 60 * 60 * 1000);
}

export async function isLivingReportActive(reportId: string): Promise<boolean> {
  const row = await queryOne(
    `SELECT 1 FROM report_monitors
     WHERE report_id = $1
       AND monitor_kind = 'living_report'
       AND status = 'active'
     LIMIT 1`,
    [reportId],
  );
  return row !== null;
}

export function isSovereignRetentionExempt(cfg: RetentionConfig = retentionConfig): boolean {
  return cfg.sovereignCustomRetention;
}

export function getRetentionPolicySnapshot(cfg: RetentionConfig = retentionConfig): Record<string, unknown> {
  return {
    tempUploadHours: cfg.tempUploadHours,
    failedRunDays: cfg.failedRunDays,
    finalizedWorkspaceDays: cfg.finalizedWorkspaceDays,
    reportRetentionDays: cfg.reportRetentionDays,
    livingReportGraceDays: cfg.livingReportGraceDays,
    sovereignCustomRetention: cfg.sovereignCustomRetention,
    capturedAt: new Date().toISOString(),
  };
}
