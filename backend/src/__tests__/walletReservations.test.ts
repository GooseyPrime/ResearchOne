import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const withTransactionMock = vi.fn();

vi.mock('../db/pool', () => ({
  get query() { return queryMock; },
  get withTransaction() { return withTransactionMock; },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { placeHold, consumeHold, releaseHold, getAvailableBalance, reapExpiredHolds } from '../services/billing/walletReservations';

describe('walletReservations', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getAvailableBalance', () => {
    it('returns balance_cents - reserved_cents', async () => {
      queryMock.mockResolvedValueOnce([{ available: '6000' }]);
      const balance = await getAvailableBalance('u1');
      expect(balance).toBe(6000);
    });

    it('returns 0 when no wallet row exists', async () => {
      queryMock.mockResolvedValueOnce([]);
      const balance = await getAvailableBalance('u_new');
      expect(balance).toBe(0);
    });

    it('falls back to balance_cents when reserved_cents column missing', async () => {
      queryMock.mockRejectedValueOnce(Object.assign(new Error('column does not exist'), { code: '42703' }));
      queryMock.mockResolvedValueOnce([{ balance_cents: '10000' }]);
      const balance = await getAvailableBalance('u_legacy');
      expect(balance).toBe(10000);
    });
  });

  describe('placeHold', () => {
    it('succeeds when sufficient balance', async () => {
      withTransactionMock.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: '10000', reserved_cents: '400' }] })
            .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 'hold_1' }] }),
        };
        return fn(mockClient);
      });
      const result = await placeHold('u1', 'run_1', 400);
      expect(result.success).toBe(true);
      expect(result.holdId).toBe('hold_1');
    });

    it('fails when insufficient balance', async () => {
      withTransactionMock.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
        const mockClient = {
          query: vi.fn()
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValueOnce({ rowCount: 0, rows: [] })
            .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: '300', reserved_cents: '0' }] }),
        };
        return fn(mockClient);
      });
      const result = await placeHold('u1', 'run_1', 400);
      expect(result.success).toBe(false);
      expect(result.availableBalanceCents).toBe(300);
    });
  });

  describe('consumeHold', () => {
    it('converts active hold to consumed and writes ledger debit', async () => {
      const queryCalls: string[] = [];
      withTransactionMock.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
        const mockClient = {
          query: vi.fn().mockImplementation((sql: string) => {
            if (typeof sql === 'string') queryCalls.push(sql.slice(0, 40));
            if (sql.includes('SELECT hold_cents')) {
              return { rowCount: 1, rows: [{ hold_cents: '400', status: 'active' }] };
            }
            return { rowCount: 1, rows: [] };
          }),
        };
        return fn(mockClient);
      });
      await consumeHold('hold_1', 'u1', 'run_1');
      expect(queryCalls).toContainEqual(expect.stringContaining('SELECT hold_cents'));
      expect(queryCalls).toContainEqual(expect.stringContaining('UPDATE wallet_holds SET status'));
      expect(queryCalls).toContainEqual(expect.stringContaining('UPDATE user_wallets'));
      expect(queryCalls).toContainEqual(expect.stringContaining('INSERT INTO wallet_ledger'));
    });

    it('skips if hold already consumed', async () => {
      withTransactionMock.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
        const mockClient = {
          query: vi.fn().mockResolvedValue({ rowCount: 1, rows: [{ hold_cents: '400', status: 'consumed' }] }),
        };
        return fn(mockClient);
      });
      await consumeHold('hold_1', 'u1', 'run_1');
    });
  });

  describe('releaseHold', () => {
    it('releases active hold and decrements reserved_cents', async () => {
      const queryCalls: string[] = [];
      withTransactionMock.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
        const mockClient = {
          query: vi.fn().mockImplementation((sql: string) => {
            if (typeof sql === 'string') queryCalls.push(sql.slice(0, 40));
            if (sql.includes('SELECT hold_cents')) {
              return { rowCount: 1, rows: [{ hold_cents: '400', status: 'active' }] };
            }
            return { rowCount: 1, rows: [] };
          }),
        };
        return fn(mockClient);
      });
      await releaseHold('hold_1', 'u1');
      expect(queryCalls).toContainEqual(expect.stringContaining("status = 'releas"));
      expect(queryCalls).toContainEqual(expect.stringContaining('reserved_'));
    });
  });

  describe('reapExpiredHolds', () => {
    it('expires active holds past their expiry', async () => {
      queryMock
        .mockResolvedValueOnce([
          { id: 'h1', user_id: 'u1', hold_cents: '400' },
          { id: 'h2', user_id: 'u2', hold_cents: '600' },
        ])
        .mockResolvedValue([]);
      const count = await reapExpiredHolds();
      expect(count).toBe(2);
    });

    it('tolerates missing table', async () => {
      queryMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const count = await reapExpiredHolds();
      expect(count).toBe(0);
    });
  });
});
