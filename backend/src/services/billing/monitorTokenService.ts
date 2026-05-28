import type { PoolClient } from 'pg';
import { getPool, query, withTransaction } from '../../db/pool';
import { logger } from '../../utils/logger';
import { MONITOR_TOKEN_ACTIVE_MONTHS } from './monitorTokenCatalog';

export interface MonitorTokenBalanceView {
  tokenBalance: number;
  autoTopupEnabled: boolean;
  autoTopupPackageId: string | null;
}

function parseTokenInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.max(0, Math.floor(value));
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Math.max(0, parseInt(value, 10));
  return 0;
}

function isMissingSchemaError(err: unknown): boolean {
  const e = err as { code?: string };
  return e?.code === '42P01' || e?.code === '42703';
}

async function adminWithTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function ensureBalanceRow(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO user_monitor_balances (user_id, token_balance)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

export async function getMonitorTokenBalance(userId: string): Promise<MonitorTokenBalanceView> {
  try {
    const rows = await query<{
      token_balance: number;
      auto_topup_enabled: boolean;
      auto_topup_package_id: string | null;
    }>(
      `SELECT token_balance, auto_topup_enabled, auto_topup_package_id
       FROM user_monitor_balances WHERE user_id = $1`,
      [userId]
    );
    const row = rows[0];
    return {
      tokenBalance: parseTokenInt(row?.token_balance),
      autoTopupEnabled: Boolean(row?.auto_topup_enabled),
      autoTopupPackageId: row?.auto_topup_package_id ?? null,
    };
  } catch (err) {
    if (isMissingSchemaError(err)) {
      return { tokenBalance: 0, autoTopupEnabled: false, autoTopupPackageId: null };
    }
    throw err;
  }
}

export async function updateMonitorTokenPreferences(
  userId: string,
  prefs: { autoTopupEnabled?: boolean; autoTopupPackageId?: string | null }
): Promise<MonitorTokenBalanceView> {
  return withTransaction(async (client) => {
    await ensureBalanceRow(client, userId);
    const sets: string[] = ['updated_at = NOW()'];
    const params: unknown[] = [userId];
    let idx = 2;
    if (prefs.autoTopupEnabled !== undefined) {
      sets.push(`auto_topup_enabled = $${idx++}`);
      params.push(prefs.autoTopupEnabled);
    }
    if (prefs.autoTopupPackageId !== undefined) {
      sets.push(`auto_topup_package_id = $${idx++}`);
      params.push(prefs.autoTopupPackageId);
    }
    await client.query(
      `UPDATE user_monitor_balances SET ${sets.join(', ')} WHERE user_id = $1`,
      params
    );
    const row = await client.query<{
      token_balance: number;
      auto_topup_enabled: boolean;
      auto_topup_package_id: string | null;
    }>(
      `SELECT token_balance, auto_topup_enabled, auto_topup_package_id
       FROM user_monitor_balances WHERE user_id = $1`,
      [userId]
    );
    const r = row.rows[0];
    return {
      tokenBalance: parseTokenInt(r?.token_balance),
      autoTopupEnabled: Boolean(r?.auto_topup_enabled),
      autoTopupPackageId: r?.auto_topup_package_id ?? null,
    };
  });
}

type CreditInput = {
  userId: string;
  tokenCount: number;
  idempotencyKey: string;
  reason: string;
  stripeCheckoutSessionId?: string;
};

export async function creditMonitorTokens(input: CreditInput): Promise<{ applied: boolean; tokenBalance: number }> {
  if (input.tokenCount <= 0) return { applied: false, tokenBalance: 0 };

  return adminWithTransaction(async (client) => {
    await ensureBalanceRow(client, input.userId);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO monitor_token_ledger (user_id, delta, reason, idempotency_key, stripe_checkout_session_id)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (idempotency_key) DO NOTHING
       RETURNING id`,
      [
        input.userId,
        input.tokenCount,
        input.reason,
        input.idempotencyKey,
        input.stripeCheckoutSessionId ?? null,
      ]
    );
    if (inserted.rowCount === 0) {
      const bal = await client.query<{ token_balance: number }>(
        'SELECT token_balance FROM user_monitor_balances WHERE user_id = $1',
        [input.userId]
      );
      return { applied: false, tokenBalance: parseTokenInt(bal.rows[0]?.token_balance) };
    }
    const updated = await client.query<{ token_balance: number }>(
      `UPDATE user_monitor_balances
       SET token_balance = token_balance + $1, updated_at = NOW()
       WHERE user_id = $2
       RETURNING token_balance`,
      [input.tokenCount, input.userId]
    );
    return { applied: true, tokenBalance: parseTokenInt(updated.rows[0]?.token_balance) };
  });
}

type DeductInput = {
  userId: string;
  monitorId: string;
  idempotencyKey: string;
  reason: string;
};

/** Deduct exactly one token inside an existing transaction (caller holds client). */
export async function deductOneMonitorTokenInTx(
  client: PoolClient,
  input: DeductInput
): Promise<{ applied: boolean; tokenBalance: number }> {
  await ensureBalanceRow(client, input.userId);

  const inserted = await client.query<{ id: string }>(
    `INSERT INTO monitor_token_ledger (user_id, delta, reason, idempotency_key, monitor_id)
     VALUES ($1, -1, $2, $3, $4)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [input.userId, input.reason, input.idempotencyKey, input.monitorId]
  );
  if (inserted.rowCount === 0) {
    const prior = await client.query<{ id: string }>(
      'SELECT id FROM monitor_token_ledger WHERE idempotency_key = $1',
      [input.idempotencyKey]
    );
    if (prior.rowCount === 0) {
      throw new Error('INSUFFICIENT_MONITOR_TOKENS');
    }
    const bal = await client.query<{ token_balance: number }>(
      'SELECT token_balance FROM user_monitor_balances WHERE user_id = $1',
      [input.userId]
    );
    return { applied: false, tokenBalance: parseTokenInt(bal.rows[0]?.token_balance) };
  }

  const locked = await client.query<{ token_balance: number }>(
    `SELECT token_balance FROM user_monitor_balances WHERE user_id = $1 FOR UPDATE`,
    [input.userId]
  );
  const current = parseTokenInt(locked.rows[0]?.token_balance);
  if (current < 1) {
    throw new Error('INSUFFICIENT_MONITOR_TOKENS');
  }

  const updated = await client.query<{ token_balance: number }>(
    `UPDATE user_monitor_balances
     SET token_balance = token_balance - 1, updated_at = NOW()
     WHERE user_id = $1 AND token_balance >= 1
     RETURNING token_balance`,
    [input.userId]
  );
  if (updated.rowCount === 0) {
    throw new Error('INSUFFICIENT_MONITOR_TOKENS');
  }
  return { applied: true, tokenBalance: parseTokenInt(updated.rows[0]?.token_balance) };
}

export function monitorActiveExpirySql(): string {
  return `NOW() + INTERVAL '${MONITOR_TOKEN_ACTIVE_MONTHS} months'`;
}

export async function tryDeductTokenForMonitorRenewal(args: {
  userId: string;
  monitorId: string;
  idempotencyKey: string;
}): Promise<boolean> {
  try {
    const result = await withTransaction((client) =>
      deductOneMonitorTokenInTx(client, {
        userId: args.userId,
        monitorId: args.monitorId,
        idempotencyKey: args.idempotencyKey,
        reason: 'auto_renew',
      })
    );
    return result.applied;
  } catch (err) {
    if (err instanceof Error && err.message === 'INSUFFICIENT_MONITOR_TOKENS') {
      return false;
    }
    if (isMissingSchemaError(err)) {
      logger.debug('monitor_token_renewal_skipped_schema', { monitorId: args.monitorId });
      return false;
    }
    throw err;
  }
}
