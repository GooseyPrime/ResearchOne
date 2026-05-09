export interface RetentionConfig {
  tempUploadHours: number;
  failedRunDays: number;
  finalizedWorkspaceDays: number;
  reportRetentionDays: number;
  livingReportGraceDays: number;
  retentionBatchLimit: number;
  retentionDryRun: boolean;
  disableRetentionJobs: boolean;
  sovereignCustomRetention: boolean;
  uploadStagingDir: string;
  textQueueInlineMaxBytes: number;
}

function parsePositiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    throw new Error(`Invalid retention config: ${name} must be a positive integer, got "${raw}"`);
  }
  return parsed;
}

function parseBool(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1';
}

export function buildRetentionConfig(): RetentionConfig {
  const nodeEnv = process.env.NODE_ENV || 'development';

  const cfg: RetentionConfig = {
    tempUploadHours: parsePositiveInt(process.env.RETENTION_TEMP_UPLOAD_HOURS, 72, 'RETENTION_TEMP_UPLOAD_HOURS'),
    failedRunDays: parsePositiveInt(process.env.RETENTION_FAILED_RUN_DAYS, 14, 'RETENTION_FAILED_RUN_DAYS'),
    finalizedWorkspaceDays: parsePositiveInt(process.env.RETENTION_FINALIZED_WORKSPACE_DAYS, 30, 'RETENTION_FINALIZED_WORKSPACE_DAYS'),
    reportRetentionDays: parsePositiveInt(process.env.RETENTION_REPORT_DAYS, 120, 'RETENTION_REPORT_DAYS'),
    livingReportGraceDays: parsePositiveInt(process.env.RETENTION_LIVING_REPORT_GRACE_DAYS, 30, 'RETENTION_LIVING_REPORT_GRACE_DAYS'),
    retentionBatchLimit: parsePositiveInt(process.env.RETENTION_BATCH_LIMIT, 100, 'RETENTION_BATCH_LIMIT'),
    retentionDryRun: parseBool(process.env.RETENTION_DRY_RUN, false),
    disableRetentionJobs: parseBool(process.env.RETENTION_JOBS_DISABLED, false),
    sovereignCustomRetention: parseBool(process.env.SOVEREIGN_CUSTOM_RETENTION, false),
    uploadStagingDir: process.env.UPLOAD_STAGING_DIR || (nodeEnv === 'test' ? '/tmp/researchone-test/uploads' : '/tmp/researchone/uploads'),
    textQueueInlineMaxBytes: parsePositiveInt(process.env.TEXT_QUEUE_INLINE_MAX_BYTES, 262144, 'TEXT_QUEUE_INLINE_MAX_BYTES'),
  };

  if (cfg.reportRetentionDays < cfg.finalizedWorkspaceDays) {
    throw new Error(
      `Invalid retention config: reportRetentionDays (${cfg.reportRetentionDays}) must be >= finalizedWorkspaceDays (${cfg.finalizedWorkspaceDays})`,
    );
  }

  if (cfg.livingReportGraceDays < 7 && nodeEnv !== 'test') {
    throw new Error(
      `Invalid retention config: livingReportGraceDays (${cfg.livingReportGraceDays}) must be >= 7 in non-test environments`,
    );
  }

  return cfg;
}

export const retentionConfig = buildRetentionConfig();
