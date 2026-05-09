import { retentionConfig } from '../config/retention';
import { runRetentionSweep } from '../services/retention/retentionService';
import { logger } from '../utils/logger';

let intervalId: ReturnType<typeof setInterval> | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

export function startRetentionCleanupCron(): void {
  if (intervalId) return;

  async function runSweep() {
    if (retentionConfig.disableRetentionJobs) {
      logger.info('retention_cleanup_skipped', { reason: 'RETENTION_JOBS_DISABLED' });
      return;
    }

    try {
      const result = await runRetentionSweep({
        dryRun: retentionConfig.retentionDryRun,
        batchLimit: retentionConfig.retentionBatchLimit,
      });
      logger.info('retention_cleanup_completed', result);
    } catch (err) {
      logger.error('retention_cleanup_error', {
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  runSweep();
  intervalId = setInterval(runSweep, ONE_DAY_MS);
}

export function stopRetentionCleanupCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
