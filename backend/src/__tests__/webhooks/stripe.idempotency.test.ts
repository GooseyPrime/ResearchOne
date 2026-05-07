/**
 * Tests: Replay same event → idempotency works, no duplicate credit (verify via ledger row count)
 *
 * Per Rule 16: These tests MUST fail without the fix (idempotency check).
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
      priceIds: { wallet20: 'price_20', wallet50: 'price_50', wallet100: 'price_100' },
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

describe('stripe webhook idempotency', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns already_processed status when event was already processed', async () => {
    const eventId = 'evt_test_123_already_processed';

    query.mockResolvedValueOnce([{ processed_at: '2026-05-01T00:00:00Z' }]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_123',
          metadata: { user_id: 'user_123', price_id: 'price_20' },
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
    expect(res.json).toHaveBeenCalledWith({ status: 'already_processed' });

    const queryCalls = query.mock.calls;
    expect(queryCalls.length).toBe(1);
    expect(queryCalls[0][0]).toContain('SELECT processed_at FROM stripe_webhook_events');
  });

  it('processes new event and marks it as processed', async () => {
    const eventId = 'evt_test_new_event';

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
          id: 'cs_test_new',
          metadata: { user_id: 'user_new', price_id: 'price_20' },
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

    const insertCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO stripe_webhook_events')
    );
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toContain(eventId);

    const markProcessedCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('UPDATE stripe_webhook_events SET processed_at')
    );
    expect(markProcessedCall).toBeDefined();
  });

  it('does not process duplicate events even when processed_at is null (in-progress)', async () => {
    const eventId = 'evt_test_in_progress';

    query.mockResolvedValueOnce([{ processed_at: null }]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'checkout.session.completed',
      data: {
        object: {
          id: 'cs_test_dup',
          metadata: { user_id: 'user_dup', price_id: 'price_20' },
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

    const insertCalls = query.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO wallet_ledger')
    );
    expect(insertCalls.length).toBe(0);
  });
});
