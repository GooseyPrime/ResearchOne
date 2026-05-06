import { describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const queryOne = vi.fn();
const withTransaction = vi.fn();

vi.mock('../db/pool', () => ({
  query,
  queryOne,
  withTransaction,
}));

describe('walletService transaction behavior', () => {
  it('bubbles errors when transaction fails mid-flight', async () => {
    const client = { query: vi.fn() };
    const db = { balance: 0, committed: false };

    withTransaction.mockImplementation(async (fn: (c: typeof client) => Promise<unknown>) => {
      try {
        await fn(client);
        db.committed = true;
      } catch (err) {
        db.committed = false;
        throw err;
      }
    });

    client.query.mockImplementation(async (sql: string) => {
      if (sql.includes('INSERT INTO user_wallets')) return { rowCount: 1, rows: [] };
      if (sql.includes('INSERT INTO wallet_ledger')) return { rowCount: 1, rows: [{ id: 1 }] };
      if (sql.includes('UPDATE user_wallets')) {
        throw new Error('forced update failure');
      }
      return { rowCount: 0, rows: [] };
    });

    const { creditWallet } = await import('../services/billing/walletService');

    await expect(
      creditWallet({
        userId: 'u_tx',
        amountCents: 2000,
        description: 'Top-up',
        idempotencyKey: 'rollback-key',
      })
    ).rejects.toThrow('forced update failure');

    expect(db.committed).toBe(false);
  });
});
