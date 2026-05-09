import * as fs from 'fs';
import * as path from 'path';
import { retentionConfig, RetentionConfig } from '../../config/retention';
import { query, withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';
import {
  computeReportExpiry,
  computeWorkspaceExpiry,
  getRetentionPolicySnapshot,
  isLivingReportActive,
  isSovereignRetentionExempt,
} from './retentionPolicy';

export interface RetentionSweepOptions {
  dryRun?: boolean;
  batchLimit?: number;
  cfg?: RetentionConfig;
}

export interface RetentionSweepResult {
  candidateReports: number;
  purgedWorkspaces: number;
  expiredReports: number;
  purgedAtlasExports: number;
  skippedLivingReports: number;
  purgedFailedRuns: number;
  purgedStagedFiles: number;
  errors: number;
}

export async function recordRetentionEvent(
  entityType: string,
  entityId: string,
  action: string,
  reason: string | null,
  beforeState: Record<string, unknown>,
  afterState: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  await query(
    `INSERT INTO retention_events (entity_type, entity_id, action, reason, before_state, after_state, dry_run)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [entityType, entityId, action, reason, JSON.stringify(beforeState), JSON.stringify(afterState), dryRun],
  );
}

export async function markReportFinalizedRetention(
  reportId: string,
  finalizedAt: Date,
  cfg: RetentionConfig = retentionConfig,
): Promise<void> {
  const { reportExpiresAt, workspaceExpiresAt } = computeReportExpiry(finalizedAt, cfg);
  const policySnapshot = getRetentionPolicySnapshot(cfg);

  try {
    await query(
      `UPDATE reports
       SET report_expires_at = $1,
           workspace_expires_at = $2,
           retention_status = 'active',
           retention_policy = $3
       WHERE id = $4
         AND report_expires_at IS NULL`,
      [reportExpiresAt.toISOString(), workspaceExpiresAt.toISOString(), JSON.stringify(policySnapshot), reportId],
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '42703') {
      logger.warn('retention_columns_not_yet_available', { reportId, hint: 'migration 028 not applied yet' });
      return;
    }
    throw err;
  }
}

export async function markRunTerminalRetention(
  runId: string,
  terminalStatus: string,
  terminalAt: Date,
  cfg: RetentionConfig = retentionConfig,
): Promise<void> {
  const workspaceExpiresAt = computeWorkspaceExpiry(terminalAt, terminalStatus, cfg);
  const policySnapshot = getRetentionPolicySnapshot(cfg);

  try {
    await query(
      `UPDATE research_runs
       SET workspace_expires_at = $1,
           retention_policy = $2
       WHERE id = $3
         AND workspace_expires_at IS NULL`,
      [workspaceExpiresAt.toISOString(), JSON.stringify(policySnapshot), runId],
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string }).code;
    if (pgCode === '42703') {
      logger.warn('retention_columns_not_yet_available', { runId, hint: 'migration 028 not applied yet' });
      return;
    }
    throw err;
  }
}

export async function purgeExpiredWorkspaces(opts: RetentionSweepOptions = {}): Promise<{ purged: number; skippedLiving: number }> {
  const dryRun = opts.dryRun ?? false;
  const batchLimit = opts.batchLimit ?? retentionConfig.retentionBatchLimit;
  let purged = 0;
  let skippedLiving = 0;

  if (isSovereignRetentionExempt(opts.cfg)) return { purged, skippedLiving };

  const candidates = await query<{ id: string; run_id: string | null }>(
    `SELECT id, run_id FROM reports
     WHERE workspace_expires_at <= NOW()
       AND workspace_purged_at IS NULL
       AND retention_status NOT IN ('workspace_purged', 'expired', 'deleted', 'sovereign_custom')
     ORDER BY workspace_expires_at ASC
     LIMIT $1`,
    [batchLimit],
  );

  for (const report of candidates) {
    try {
      const isLiving = await isLivingReportActive(report.id);
      if (isLiving) {
        skippedLiving++;
        continue;
      }

      if (dryRun) {
        await recordRetentionEvent('report', report.id, 'workspace_purge', 'expired workspace', { retention_status: 'active' }, { retention_status: 'workspace_purged' }, true);
        purged++;
        continue;
      }

      await withTransaction(async (client) => {
        // Scrub heavy source content for sources linked to this report's run
        // rather than DELETE-ing sources (which would SET NULL on report_citations.source_id).
        // We null out raw_content, then delete the document/chunk/embedding subtree.
        if (report.run_id) {
          await client.query(
            `UPDATE sources SET raw_content = NULL, purged_at = NOW()
             WHERE discovered_by_run_id = $1 AND purged_at IS NULL`,
            [report.run_id],
          );

          // Delete documents (cascades to chunks -> embeddings)
          await client.query(
            `DELETE FROM documents WHERE source_id IN (
               SELECT id FROM sources WHERE discovered_by_run_id = $1
             )`,
            [report.run_id],
          );
        }

        await client.query(
          `UPDATE reports
           SET workspace_purged_at = NOW(),
               retention_status = 'workspace_purged'
           WHERE id = $1`,
          [report.id],
        );

        if (report.run_id) {
          await client.query(
            `UPDATE research_runs SET workspace_purged_at = NOW() WHERE id = $1`,
            [report.run_id],
          );
        }
      });

      await recordRetentionEvent('report', report.id, 'workspace_purge', 'expired workspace', { retention_status: 'active' }, { retention_status: 'workspace_purged' }, false);
      purged++;
    } catch (err) {
      logger.error('retention_workspace_purge_error', { reportId: report.id, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return { purged, skippedLiving };
}

export async function expireOldReports(opts: RetentionSweepOptions = {}): Promise<number> {
  const dryRun = opts.dryRun ?? false;
  const batchLimit = opts.batchLimit ?? retentionConfig.retentionBatchLimit;
  let expired = 0;

  if (isSovereignRetentionExempt(opts.cfg)) return expired;

  const candidates = await query<{ id: string }>(
    `SELECT id FROM reports
     WHERE report_expires_at <= NOW()
       AND retention_status NOT IN ('expired', 'deleted', 'living_active', 'sovereign_custom')
     ORDER BY report_expires_at ASC
     LIMIT $1`,
    [batchLimit],
  );

  for (const report of candidates) {
    try {
      const isLiving = await isLivingReportActive(report.id);
      if (isLiving) {
        continue;
      }

      if (dryRun) {
        await recordRetentionEvent('report', report.id, 'report_expire', 'report retention period elapsed', {}, { retention_status: 'expired' }, true);
        expired++;
        continue;
      }

      await query(
        `UPDATE reports SET retention_status = 'expired' WHERE id = $1`,
        [report.id],
      );

      await recordRetentionEvent('report', report.id, 'report_expire', 'report retention period elapsed', {}, { retention_status: 'expired' }, false);
      expired++;
    } catch (err) {
      logger.error('retention_report_expire_error', { reportId: report.id, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return expired;
}

export async function purgeFailedOrCancelledRuns(opts: RetentionSweepOptions = {}): Promise<number> {
  const dryRun = opts.dryRun ?? false;
  const batchLimit = opts.batchLimit ?? retentionConfig.retentionBatchLimit;
  let purged = 0;

  if (isSovereignRetentionExempt(opts.cfg)) return purged;

  const candidates = await query<{ id: string }>(
    `SELECT id FROM research_runs
     WHERE workspace_expires_at <= NOW()
       AND workspace_purged_at IS NULL
       AND status IN ('failed', 'cancelled', 'aborted')
     ORDER BY workspace_expires_at ASC
     LIMIT $1`,
    [batchLimit],
  );

  for (const run of candidates) {
    try {
      if (dryRun) {
        await recordRetentionEvent('research_run', run.id, 'workspace_purge', 'failed/cancelled run', {}, { workspace_purged_at: 'NOW()' }, true);
        purged++;
        continue;
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE sources SET raw_content = NULL, purged_at = NOW()
           WHERE discovered_by_run_id = $1 AND purged_at IS NULL`,
          [run.id],
        );
        await client.query(
          `DELETE FROM documents WHERE source_id IN (
             SELECT id FROM sources WHERE discovered_by_run_id = $1
           )`,
          [run.id],
        );
        await client.query(
          `UPDATE research_runs SET workspace_purged_at = NOW() WHERE id = $1`,
          [run.id],
        );
      });

      await recordRetentionEvent('research_run', run.id, 'workspace_purge', 'failed/cancelled run', {}, { workspace_purged_at: 'set' }, false);
      purged++;
    } catch (err) {
      logger.error('retention_failed_run_purge_error', { runId: run.id, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return purged;
}

export async function purgeExpiredAtlasExports(opts: RetentionSweepOptions = {}): Promise<number> {
  const dryRun = opts.dryRun ?? false;
  const batchLimit = opts.batchLimit ?? retentionConfig.retentionBatchLimit;
  let purged = 0;

  if (isSovereignRetentionExempt(opts.cfg)) return purged;

  const candidates = await query<{ id: string; export_path: string | null; compressed_path: string | null }>(
    `SELECT id, export_path, compressed_path FROM atlas_exports
     WHERE expires_at <= NOW()
       AND purged_at IS NULL
     ORDER BY expires_at ASC
     LIMIT $1`,
    [batchLimit],
  );

  for (const exp of candidates) {
    try {
      if (dryRun) {
        await recordRetentionEvent('atlas_export', exp.id, 'purge', 'expired', {}, {}, true);
        purged++;
        continue;
      }

      for (const filePath of [exp.export_path, exp.compressed_path]) {
        if (filePath && fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      }

      await query(`UPDATE atlas_exports SET purged_at = NOW() WHERE id = $1`, [exp.id]);
      await recordRetentionEvent('atlas_export', exp.id, 'purge', 'expired', {}, { purged_at: 'set' }, false);
      purged++;
    } catch (err) {
      logger.error('retention_atlas_purge_error', { exportId: exp.id, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  return purged;
}

export function purgeExpiredStagedFiles(cfg: RetentionConfig = retentionConfig, dryRun = false): number {
  const stagingDir = cfg.uploadStagingDir;
  if (!fs.existsSync(stagingDir)) return 0;

  const maxAgeMs = cfg.tempUploadHours * 60 * 60 * 1000;
  const now = Date.now();
  let purged = 0;

  for (const entry of fs.readdirSync(stagingDir)) {
    const filePath = path.join(stagingDir, entry);
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile()) continue;
      if (now - stat.mtimeMs > maxAgeMs) {
        if (!dryRun) fs.unlinkSync(filePath);
        purged++;
      }
    } catch {
      // best-effort: skip files we can't stat
    }
  }

  return purged;
}

export async function runRetentionSweep(opts: RetentionSweepOptions = {}): Promise<RetentionSweepResult> {
  const result: RetentionSweepResult = {
    candidateReports: 0,
    purgedWorkspaces: 0,
    expiredReports: 0,
    purgedAtlasExports: 0,
    skippedLivingReports: 0,
    purgedFailedRuns: 0,
    purgedStagedFiles: 0,
    errors: 0,
  };

  try {
    const cfg = opts.cfg ?? retentionConfig;
    result.purgedStagedFiles = purgeExpiredStagedFiles(cfg, opts.dryRun ?? false);
  } catch (err) {
    result.errors++;
    logger.error('retention_sweep_staged_files_error', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  try {
    const workspace = await purgeExpiredWorkspaces(opts);
    result.purgedWorkspaces = workspace.purged;
    result.skippedLivingReports = workspace.skippedLiving;
    result.candidateReports = workspace.purged + workspace.skippedLiving;
  } catch (err) {
    result.errors++;
    logger.error('retention_sweep_workspace_error', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  try {
    result.expiredReports = await expireOldReports(opts);
  } catch (err) {
    result.errors++;
    logger.error('retention_sweep_expire_error', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  try {
    result.purgedFailedRuns = await purgeFailedOrCancelledRuns(opts);
  } catch (err) {
    result.errors++;
    logger.error('retention_sweep_failed_runs_error', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  try {
    result.purgedAtlasExports = await purgeExpiredAtlasExports(opts);
  } catch (err) {
    result.errors++;
    logger.error('retention_sweep_atlas_error', { error: err instanceof Error ? err.message : 'Unknown' });
  }

  return result;
}
