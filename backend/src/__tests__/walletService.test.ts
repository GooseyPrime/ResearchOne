import type { PoolClient } from 'pg';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const withTransaction = vi.fn();

vi.mock('../db/pool', () => ({
  query,
  withTransaction,
}));

describe('walletService credit/debit idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('credits once for the same idempotency key', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // ensure wallet row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ledger insert
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 2000 }] }) // wallet update
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // ensure wallet row (2nd call)
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }) // ledger conflict
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 2000 }] }), // wallet read
    };
    withTransaction.mockImplementation((fn: (c: PoolClient) => Promise<unknown>) =>
      fn(client as unknown as PoolClient),
    );

    const { creditWallet } = await import('../services/billing/walletService');

    const first = await creditWallet({
      userId: 'user_1',
      amountCents: 2000,
      description: 'Top-up',
      idempotencyKey: 'evt_1',
    });
    const second = await creditWallet({
      userId: 'user_1',
      amountCents: 2000,
      description: 'Top-up',
      idempotencyKey: 'evt_1',
    });

    expect(first).toEqual({ applied: true, balanceCents: 2000 });
    expect(second).toEqual({ applied: false, balanceCents: 2000 });
  });

  it('debit fails when balance is insufficient', async () => {
    const client = {
      query: vi
        .fn()
        .mockResolvedValueOnce({ rowCount: 1, rows: [] }) // ensure wallet row
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] }) // ledger insert
        .mockResolvedValueOnce({ rowCount: 0, rows: [] }), // failed debit update
    };
    withTransaction.mockImplementation((fn: (c: PoolClient) => Promise<unknown>) =>
      fn(client as unknown as PoolClient),
    );

    const { debitWallet } = await import('../services/billing/walletService');

    await expect(
      debitWallet({
        userId: 'user_1',
        amountCents: 9999,
        description: 'Run charge',
        idempotencyKey: 'charge_1',
      })
    ).rejects.toThrow('Insufficient wallet balance');
  });
});
