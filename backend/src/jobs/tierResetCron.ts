import { resetMonthlyCounters } from '../services/tier/tierService';
import { reapExpiredHolds } from '../services/billing/walletReservations';
import { logger } from '../utils/logger';

let intervalId: ReturnType<typeof setInterval> | null = null;

/**
 * Starts the daily tier reset cron job.
 * Runs at UTC midnight daily and resets monthly counters for users whose
 * current_period_resets_at has passed.
 *
 * Uses setInterval instead of node-cron to avoid adding a dependency.
 * The interval checks every hour; resetMonthlyCounters itself is idempotent
 * (only resets users whose period has actually passed).
 */
export function startTierResetCron(): void {
  if (intervalId) return;

  const ONE_HOUR_MS = 60 * 60 * 1000;

  async function runReset() {
    try {
      const resetCount = await resetMonthlyCounters();
      if (resetCount > 0) {
        logger.info('tier_monthly_counters_reset', { usersReset: resetCount });
      }
    } catch (err) {
      logger.error('tier_reset_cron_error', { error: err instanceof Error ? err.message : 'Unknown' });
    }

    try {
      const reapedCount = await reapExpiredHolds();
      if (reapedCount > 0) {
        logger.info('wallet_holds_reaped_by_cron', { count: reapedCount });
      }
    } catch (err) {
      logger.error('wallet_hold_reap_cron_error', { error: err instanceof Error ? err.message : 'Unknown' });
    }
  }

  runReset();

  intervalId = setInterval(runReset, ONE_HOUR_MS);
}

export function stopTierResetCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
