import type { PoolClient } from 'pg';
import { query, withTransaction } from '../../db/pool';

export type WalletEntryType = 'credit' | 'debit';

export interface WalletLedgerEntry {
  id: number;
  amount_cents: number;
  entry_type: WalletEntryType;
  description: string;
  idempotency_key: string;
  stripe_checkout_session_id: string | null;
  created_at: string;
  balance_after_cents?: number;
}

export interface WalletSummary {
  balanceCents: number;
  currency: string;
  history: WalletLedgerEntry[];
}

type WalletMutationResult = {
  applied: boolean;
  balanceCents: number;
};

type WalletMutationInput = {
  userId: string;
  amountCents: number;
  entryType: WalletEntryType;
  description: string;
  idempotencyKey: string;
  stripeCheckoutSessionId?: string;
  metadata?: Record<string, unknown>;
};

/** `pg` returns BIGINT columns as strings unless a type parser is set — normalize for JSON/API consumers. */
function parseMoneyInt(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d+$/.test(value)) return Number(value);
  return 0;
}

async function ensureWalletRow(client: PoolClient, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO user_wallets (user_id, balance_cents)
     VALUES ($1, 0)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId]
  );
}

async function mutateWallet(client: PoolClient, input: WalletMutationInput): Promise<WalletMutationResult> {
  await ensureWalletRow(client, input.userId);

  const inserted = await client.query<{ id: number }>(
    `INSERT INTO wallet_ledger (
      user_id, amount_cents, entry_type, description, idempotency_key, stripe_checkout_session_id, metadata
     ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id`,
    [
      input.userId,
      input.amountCents,
      input.entryType,
      input.description,
      input.idempotencyKey,
      input.stripeCheckoutSessionId ?? null,
      JSON.stringify(input.metadata ?? {}),
    ]
  );

  if (inserted.rowCount === 0) {
    const wallet = await client.query<{ balance_cents: number }>(
      'SELECT balance_cents FROM user_wallets WHERE user_id = $1',
      [input.userId]
    );
    return {
      applied: false,
      balanceCents: parseMoneyInt(wallet.rows[0]?.balance_cents),
    };
  }

  if (input.entryType === 'debit') {
    const enough = await client.query(
      `UPDATE user_wallets
       SET balance_cents = balance_cents - $1,
           updated_at = NOW()
       WHERE user_id = $2
         AND balance_cents >= $1
       RETURNING balance_cents`,
      [input.amountCents, input.userId]
    );
    if (enough.rowCount === 0) {
      throw new Error('Insufficient wallet balance');
    }
    return { applied: true, balanceCents: parseMoneyInt(enough.rows[0].balance_cents) };
  }

  const credited = await client.query<{ balance_cents: number }>(
    `UPDATE user_wallets
     SET balance_cents = balance_cents + $1,
         updated_at = NOW()
     WHERE user_id = $2
     RETURNING balance_cents`,
    [input.amountCents, input.userId]
  );
  return { applied: true, balanceCents: parseMoneyInt(credited.rows[0].balance_cents) };
}

export async function creditWallet(input: Omit<WalletMutationInput, 'entryType'>): Promise<WalletMutationResult> {
  return withTransaction((client) =>
    mutateWallet(client, {
      ...input,
      entryType: 'credit',
    })
  );
}

export async function debitWallet(input: Omit<WalletMutationInput, 'entryType'>): Promise<WalletMutationResult> {
  return withTransaction((client) =>
    mutateWallet(client, {
      ...input,
      entryType: 'debit',
    })
  );
}

export async function getWalletSummary(userId: string): Promise<WalletSummary> {
  const wallet = await query<{ balance_cents: number; currency: string }>(
    'SELECT balance_cents, currency FROM user_wallets WHERE user_id = $1',
    [userId]
  );
  const historyRows = await query<WalletLedgerEntry & { balance_after_cents: number }>(
    `SELECT id, amount_cents, entry_type, description, idempotency_key, stripe_checkout_session_id, created_at,
            SUM(CASE WHEN entry_type = 'credit' THEN amount_cents ELSE -amount_cents END)
              OVER (ORDER BY created_at ASC, id ASC) AS balance_after_cents
     FROM wallet_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  const history = historyRows.map((row) => ({
    ...row,
    amount_cents: parseMoneyInt(row.amount_cents),
    balance_after_cents: parseMoneyInt(row.balance_after_cents),
  }));
  return {
    balanceCents: parseMoneyInt(wallet[0]?.balance_cents),
    currency: wallet[0]?.currency ?? 'usd',
    history,
  };
}

export interface PaginatedTransactions {
  transactions: WalletLedgerEntry[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export async function getWalletTransactions(
  userId: string,
  limit = 50,
  offset = 0
): Promise<PaginatedTransactions> {
  const countResult = await query<{ count: string }>(
    'SELECT COUNT(*)::text as count FROM wallet_ledger WHERE user_id = $1',
    [userId]
  );
  const total = parseInt(countResult[0]?.count ?? '0', 10);

  const rows = await query<WalletLedgerEntry & { balance_after_cents: number }>(
    `SELECT id, amount_cents, entry_type, description, idempotency_key, stripe_checkout_session_id, created_at,
            SUM(CASE WHEN entry_type = 'credit' THEN amount_cents ELSE -amount_cents END)
              OVER (ORDER BY created_at ASC, id ASC) AS balance_after_cents
     FROM wallet_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT $2 OFFSET $3`,
    [userId, limit, offset]
  );

  const transactions = rows.map((row) => ({
    ...row,
    amount_cents: parseMoneyInt(row.amount_cents),
    balance_after_cents: parseMoneyInt(row.balance_after_cents),
  }));

  return {
    transactions,
    total,
    limit,
    offset,
    hasMore: offset + transactions.length < total,
  };
}
