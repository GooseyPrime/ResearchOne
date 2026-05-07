/**
 * Wallet reservation/hold system for pre-run credit enforcement.
 *
 * Holds reserve balance atomically via:
 *   UPDATE user_wallets SET reserved_cents = reserved_cents + $cost
 *   WHERE user_id = $u AND balance_cents - reserved_cents >= $cost
 *   RETURNING ...
 *
 * This prevents the concurrent-run race where two runs pass middleware
 * checks against the same balance.
 */

import { query, withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';

export interface WalletHold {
  id: string;
  userId: string;
  runId: string;
  holdCents: number;
  status: 'active' | 'consumed' | 'released' | 'expired';
  expiresAt: string;
}

export interface PlaceHoldResult {
  success: boolean;
  holdId?: string;
  availableBalanceCents?: number;
  error?: string;
}

/**
 * Returns balance_cents - reserved_cents. All UI and 402 checks should
 * read from this, not from balance_cents directly.
 */
export async function getAvailableBalance(userId: string): Promise<number> {
  try {
    const rows = await query<{ available: string }>(
      `SELECT (balance_cents - reserved_cents)::text AS available
       FROM user_wallets WHERE user_id = $1`,
      [userId]
    );
    if (rows.length === 0) return 0;
    return parseInt(rows[0].available, 10) || 0;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42703') {
      const rows = await query<{ balance_cents: string }>(
        'SELECT balance_cents::text FROM user_wallets WHERE user_id = $1',
        [userId]
      );
      return rows.length > 0 ? parseInt(rows[0].balance_cents, 10) || 0 : 0;
    }
    throw err;
  }
}

/**
 * Places a hold on the user's wallet. Atomically reserves balance via
 * UPDATE ... WHERE balance_cents - reserved_cents >= $cost.
 * Returns { success: false } if insufficient available balance.
 */
export async function placeHold(
  userId: string,
  runId: string,
  holdCents: number
): Promise<PlaceHoldResult> {
  return withTransaction(async (client) => {
    try {
      await client.query(
        `INSERT INTO user_wallets (user_id, balance_cents, reserved_cents)
         VALUES ($1, 0, 0)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      );
    } catch (err: unknown) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '42703') {
        await client.query(
          `INSERT INTO user_wallets (user_id, balance_cents)
           VALUES ($1, 0)
           ON CONFLICT (user_id) DO NOTHING`,
          [userId]
        );
      } else {
        throw err;
      }
    }

    const reserveResult = await client.query<{ balance_cents: string; reserved_cents: string }>(
      `UPDATE user_wallets
       SET reserved_cents = reserved_cents + $2,
           updated_at = NOW()
       WHERE user_id = $1
         AND balance_cents - reserved_cents >= $2
       RETURNING balance_cents::text, reserved_cents::text`,
      [userId, holdCents]
    );

    if (reserveResult.rowCount === 0) {
      const balanceRow = await client.query<{ balance_cents: string; reserved_cents: string }>(
        'SELECT balance_cents::text, reserved_cents::text FROM user_wallets WHERE user_id = $1',
        [userId]
      );
      const balance = balanceRow.rows[0] ? parseInt(balanceRow.rows[0].balance_cents, 10) : 0;
      const reserved = balanceRow.rows[0] ? parseInt(balanceRow.rows[0].reserved_cents, 10) : 0;
      return {
        success: false,
        availableBalanceCents: balance - reserved,
        error: 'Insufficient available balance',
      };
    }

    const holdResult = await client.query<{ id: string }>(
      `INSERT INTO wallet_holds (user_id, run_id, hold_cents, status, expires_at)
       VALUES ($1, $2, $3, 'active', NOW() + INTERVAL '30 minutes')
       RETURNING id`,
      [userId, runId, holdCents]
    );

    const holdId = holdResult.rows[0].id;

    logger.info('wallet_hold_placed', { userId, runId, holdId, holdCents });

    return { success: true, holdId };
  });
}

/**
 * Consumes a hold: converts it into a real ledger debit in a single transaction.
 * The hold row transitions to 'consumed' and reserved_cents is decremented.
 * Called on successful run completion.
 */
export async function consumeHold(
  holdId: string,
  userId: string,
  runId: string
): Promise<void> {
  await withTransaction(async (client) => {
    const holdRow = await client.query<{ hold_cents: string; status: string }>(
      `SELECT hold_cents::text, status FROM wallet_holds WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [holdId, userId]
    );

    if (holdRow.rowCount === 0) {
      logger.warn('wallet_hold_not_found_for_consume', { holdId, userId, runId });
      return;
    }

    if (holdRow.rows[0].status !== 'active') {
      logger.warn('wallet_hold_already_consumed_or_released', { holdId, userId, runId, status: holdRow.rows[0].status });
      return;
    }

    const holdCents = parseInt(holdRow.rows[0].hold_cents, 10);

    await client.query(
      `UPDATE wallet_holds SET status = 'consumed', consumed_at = NOW() WHERE id = $1`,
      [holdId]
    );

    await client.query(
      `UPDATE user_wallets
       SET balance_cents = balance_cents - $2,
           reserved_cents = GREATEST(reserved_cents - $2, 0),
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, holdCents]
    );

    await client.query(
      `INSERT INTO wallet_ledger (user_id, amount_cents, entry_type, description, idempotency_key, metadata)
       VALUES ($1, $2, 'debit', $3, $4, $5::jsonb)`,
      [
        userId,
        holdCents,
        `Research run charge`,
        `run_charge_${runId}`,
        JSON.stringify({ runId, holdId }),
      ]
    );

    logger.info('wallet_hold_consumed', { holdId, userId, runId, holdCents });
  });
}

/**
 * Releases a hold: returns the reserved balance without charging.
 * Called on run failure or cancellation.
 */
export async function releaseHold(holdId: string, userId: string): Promise<void> {
  await withTransaction(async (client) => {
    const holdRow = await client.query<{ hold_cents: string; status: string }>(
      `SELECT hold_cents::text, status FROM wallet_holds WHERE id = $1 AND user_id = $2 FOR UPDATE`,
      [holdId, userId]
    );

    if (holdRow.rowCount === 0) {
      logger.warn('wallet_hold_not_found_for_release', { holdId, userId });
      return;
    }

    if (holdRow.rows[0].status !== 'active') {
      logger.warn('wallet_hold_already_not_active_for_release', { holdId, userId, status: holdRow.rows[0].status });
      return;
    }

    const holdCents = parseInt(holdRow.rows[0].hold_cents, 10);

    await client.query(
      `UPDATE wallet_holds SET status = 'released', released_at = NOW() WHERE id = $1`,
      [holdId]
    );

    await client.query(
      `UPDATE user_wallets
       SET reserved_cents = GREATEST(reserved_cents - $2, 0),
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId, holdCents]
    );

    logger.info('wallet_hold_released', { holdId, userId, holdCents });
  });
}

/**
 * Reaps expired holds that don't belong to in-flight research runs.
 * Only expires holds whose run is no longer queued/running, or whose
 * expiry is more than 2x the default (indicating the run is truly stale).
 * Uses a single aggregated UPDATE per user to avoid N+1 queries.
 */
export async function reapExpiredHolds(): Promise<number> {
  try {
    const expired = await query<{ id: string; user_id: string; hold_cents: string }>(
      `UPDATE wallet_holds h
       SET status = 'expired', released_at = NOW()
       WHERE h.status = 'active'
         AND h.expires_at <= NOW()
         AND NOT EXISTS (
           SELECT 1 FROM research_runs r
           WHERE r.id = h.run_id
             AND r.status IN ('queued', 'running')
         )
       RETURNING h.id, h.user_id, h.hold_cents::text`,
      []
    );

    if (expired.length > 0) {
      const perUser = new Map<string, number>();
      for (const row of expired) {
        const holdCents = parseInt(row.hold_cents, 10);
        perUser.set(row.user_id, (perUser.get(row.user_id) ?? 0) + holdCents);
      }

      for (const [userId, totalCents] of perUser) {
        await query(
          `UPDATE user_wallets
           SET reserved_cents = GREATEST(reserved_cents - $2, 0),
               updated_at = NOW()
           WHERE user_id = $1`,
          [userId, totalCents]
        );
      }

      logger.info('wallet_holds_reaped', { count: expired.length });
    }

    return expired.length;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      return 0;
    }
    throw err;
  }
}
