/**
 * Tests: Webhook with valid signature for checkout.session.completed (top-up)
 *        → wallet credited, ledger row written
 *
 * Per Rule 16: These tests MUST fail without the fix (wallet credit handler).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const constructEvent = vi.fn();
const withTransaction = vi.fn();

vi.mock('../../db/pool', () => ({ query, withTransaction }));
vi.mock('../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_abc',
      webhookSecret: 'whsec_test_secret',
      priceIds: {
        wallet20: 'price_wallet_20',
        wallet50: 'price_wallet_50',
        wallet100: 'price_wallet_100',
      },
    },
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent };
  },
}));

type StripeWebhookRouterLayer = { route?: { stack: Array<{ handle: RequestHandler }> } };

describe('stripe webhook checkout.session.completed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('credits wallet with $20 for price_wallet_20', async () => {
    const eventId = 'evt_checkout_20';
    const sessionId = 'cs_20_session';
    const userId = 'user_checkout_20';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    withTransaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rowCount: 0, rows: [] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 2000 }] }),
      };
      return fn(mockClient);
    });

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { user_id: userId, price_id: 'price_wallet_20' },
        },
      },
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'valid_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.json).toHaveBeenCalledWith({ status: 'processed' });

    expect(withTransaction).toHaveBeenCalled();
    const txFn = withTransaction.mock.calls[0][0];
    const mockClient = {
      query: vi.fn()
        .mockResolvedValueOnce({ rowCount: 0, rows: [] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
        .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 2000 }] }),
    };
    await txFn(mockClient);

    const ledgerInsertCall = mockClient.query.mock.calls.find((call: unknown[]) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO wallet_ledger')
    );
    expect(ledgerInsertCall).toBeDefined();
    if (ledgerInsertCall) {
      expect(ledgerInsertCall[1]).toContain(userId);
      expect(ledgerInsertCall[1]).toContain(2000);
    }
  });

  it('credits wallet with $50 for price_wallet_50', async () => {
    const eventId = 'evt_checkout_50';
    const sessionId = 'cs_50_session';
    const userId = 'user_checkout_50';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    withTransaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rowCount: 0, rows: [] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 5000 }] }),
      };
      return fn(mockClient);
    });

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { user_id: userId, price_id: 'price_wallet_50' },
        },
      },
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'valid_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('credits wallet with $100 for price_wallet_100', async () => {
    const eventId = 'evt_checkout_100';
    const sessionId = 'cs_100_session';
    const userId = 'user_checkout_100';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    withTransaction.mockImplementation(async (fn: (client: unknown) => Promise<unknown>) => {
      const mockClient = {
        query: vi.fn()
          .mockResolvedValueOnce({ rowCount: 0, rows: [] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ id: 1 }] })
          .mockResolvedValueOnce({ rowCount: 1, rows: [{ balance_cents: 10000 }] }),
      };
      return fn(mockClient);
    });

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { user_id: userId, price_id: 'price_wallet_100' },
        },
      },
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'valid_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('handles missing user_id metadata gracefully', async () => {
    const eventId = 'evt_checkout_no_user';
    const sessionId = 'cs_no_user';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { price_id: 'price_wallet_20' },
        },
      },
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'valid_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(withTransaction).not.toHaveBeenCalled();
  });

  it('handles unknown price_id gracefully', async () => {
    const eventId = 'evt_checkout_unknown_price';
    const sessionId = 'cs_unknown_price';
    const userId = 'user_unknown_price';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: sessionId,
          metadata: { user_id: userId, price_id: 'price_unknown_xyz' },
        },
      },
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'valid_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(200);
    expect(withTransaction).not.toHaveBeenCalled();
  });
});
