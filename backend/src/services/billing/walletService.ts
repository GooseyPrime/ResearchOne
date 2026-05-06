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
      balanceCents: wallet.rows[0]?.balance_cents ?? 0,
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
    return { applied: true, balanceCents: enough.rows[0].balance_cents };
  }

  const credited = await client.query<{ balance_cents: number }>(
    `UPDATE user_wallets
     SET balance_cents = balance_cents + $1,
         updated_at = NOW()
     WHERE user_id = $2
     RETURNING balance_cents`,
    [input.amountCents, input.userId]
  );
  return { applied: true, balanceCents: credited.rows[0].balance_cents };
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
  const history = await query<WalletLedgerEntry>(
    `SELECT id, amount_cents, entry_type, description, idempotency_key, stripe_checkout_session_id, created_at
     FROM wallet_ledger
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 50`,
    [userId]
  );
  return {
    balanceCents: wallet[0]?.balance_cents ?? 0,
    currency: wallet[0]?.currency ?? 'usd',
    history,
  };
}
