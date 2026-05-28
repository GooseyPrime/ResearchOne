import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';
import { createUserNotification } from '../notifications/userNotifications';
import { patchRemoteParallelMonitorForExpiry } from '../monitoring/parallelMonitorService';
import { monitorActiveExpirySql, tryDeductTokenForMonitorRenewal } from './monitorTokenService';

interface ExpiredMonitorRow {
  id: string;
  user_id: string;
  report_id: string;
  auto_renew: boolean;
  parallel_monitor_id: string;
  expires_at: string;
  topic: string | null;
}

function isMissingSchemaError(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === '42P01' || e?.code === '42703';
}

/**
 * Sweeps token-funded living_report monitors past expires_at.
 * Auto-renew consumes a token when balance allows; otherwise pauses and notifies.
 */
export async function sweepExpiredLivingReportMonitors(): Promise<number> {
  let rows: ExpiredMonitorRow[];
  try {
    rows = await adminQuery<ExpiredMonitorRow>(
      `SELECT rm.id, rm.user_id, rm.report_id, rm.auto_renew, rm.parallel_monitor_id, rm.expires_at,
              r.topic
       FROM report_monitors rm
       JOIN reports r ON r.id = rm.report_id
       WHERE rm.monitor_kind = 'living_report'
         AND rm.status = 'active'
         AND rm.expires_at IS NOT NULL
         AND rm.expires_at <= NOW()
       ORDER BY rm.expires_at ASC
       LIMIT 200`
    );
  } catch (err) {
    if (isMissingSchemaError(err)) return 0;
    throw err;
  }

  let handled = 0;
  for (const row of rows) {
    try {
      if (row.auto_renew) {
        const renewed = await tryDeductTokenForMonitorRenewal({
          userId: row.user_id,
          monitorId: row.id,
          idempotencyKey: `monitor_renew:${row.id}:${row.expires_at}`,
        });
        if (renewed) {
          await adminQuery(
            `UPDATE report_monitors
             SET expires_at = ${monitorActiveExpirySql()}, last_event_at = NOW()
             WHERE id = $1 AND status = 'active'`,
            [row.id]
          );
          await patchRemoteParallelMonitorForExpiry(row.parallel_monitor_id, { status: 'active' });
          handled += 1;
          continue;
        }
      }

      await patchRemoteParallelMonitorForExpiry(row.parallel_monitor_id, { status: 'paused' });
      await adminQuery(
        `UPDATE report_monitors
         SET status = 'paused', paused_at = NOW(), last_event_at = NOW()
         WHERE id = $1 AND status = 'active'`,
        [row.id]
      );
      await adminQuery(
        `INSERT INTO report_monitor_events (monitor_id, event_kind, payload)
         VALUES ($1, 'monitor_paused', $2::jsonb)`,
        [row.id, JSON.stringify({ reason: 'token_expired' })]
      );

      const label = row.topic?.trim() || 'your report';
      await createUserNotification({
        userId: row.user_id,
        kind: 'system',
        title: 'Living Report monitoring ended',
        body: `Your living report for "${label}" has expired. Add a token to resume monitoring.`,
        ctaPath: '/app/billing',
      });
      handled += 1;
    } catch (err) {
      logger.warn('monitor_expiry_sweep_row_failed', {
        monitorId: row.id,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  return handled;
}
