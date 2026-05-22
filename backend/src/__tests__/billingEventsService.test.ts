import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const queryOneMock = vi.fn();

vi.mock('../db/pool', () => ({
  get query() {
    return queryMock;
  },
  get queryOne() {
    return queryOneMock;
  },
}));
vi.mock('../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

import { getBillingHistory, recordBillingEvent } from '../services/billing/billingEventsService';

describe('billingEventsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('getBillingHistory', () => {
    it('merges subscription and wallet rows with status mapping', async () => {
      queryOneMock.mockResolvedValueOnce({ total: '2' });
      queryMock.mockResolvedValueOnce([
        {
          kind: 'subscription',
          id: 'be_1',
          occurred_at: '2026-05-01T12:00:00Z',
          description: 'Pro subscription started',
          amount_cents: 2900,
          currency: 'usd',
          event_kind: 'subscription_started',
          entry_type: null,
        },
        {
          kind: 'wallet',
          id: 'wl_9',
          occurred_at: '2026-05-02T12:00:00Z',
          description: 'Wallet top-up',
          amount_cents: 2000,
          currency: 'usd',
          event_kind: null,
          entry_type: 'credit',
        },
      ]);

      const result = await getBillingHistory('user_1', 25, 0);
      expect(result.total).toBe(2);
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.kind).toBe('subscription');
      expect(result.items[0]?.status).toBe('info');
      expect(result.items[1]?.kind).toBe('wallet');
      expect(result.items[1]?.status).toBe('credit');
    });

    it('returns empty feed when billing_events table is missing (deploy skew)', async () => {
      queryOneMock.mockRejectedValueOnce(Object.assign(new Error('relation does not exist'), { code: '42P01' }));
      const result = await getBillingHistory('user_1', 25, 0);
      expect(result).toEqual({ items: [], total: 0 });
    });
  });

  describe('recordBillingEvent', () => {
    it('uses ON CONFLICT DO NOTHING for stripe_event_id idempotency', async () => {
      queryMock.mockResolvedValueOnce([]);
      await recordBillingEvent({
        userId: 'user_1',
        stripeEventId: 'evt_123',
        eventKind: 'invoice_paid',
        description: 'Invoice paid',
        occurredAt: new Date('2026-05-01T00:00:00Z'),
      });
      const [sql] = queryMock.mock.calls[0] as [string];
      expect(sql).toContain('ON CONFLICT (stripe_event_id) DO NOTHING');
    });
  });
});
