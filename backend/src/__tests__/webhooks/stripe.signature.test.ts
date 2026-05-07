/**
 * Tests: Webhook with invalid signature → 400, no DB writes
 *
 * Per Rule 16: These tests MUST fail without the fix (invalid signature check).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const constructEvent = vi.fn();

vi.mock('../../db/pool', () => ({ query }));
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

describe('stripe webhook signature verification', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 400 for invalid signature', async () => {
    constructEvent.mockImplementationOnce(() => {
      throw new Error('Webhook signature verification failed');
    });

    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'invalid_sig_v1=abc' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Invalid signature' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 400 when stripe-signature header is missing', async () => {
    const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
    const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: {},
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith({ error: 'Missing stripe-signature header' });
    expect(query).not.toHaveBeenCalled();
  });

  it('returns 503 when webhook secret is not configured', async () => {
    vi.doMock('../../config', () => ({
      config: {
        stripe: {
          secretKey: 'sk_test_abc',
          webhookSecret: '',
          priceIds: {},
        },
      },
    }));
    vi.resetModules();

    const { default: router } = await import('../../api/webhooks/stripe') as { default: unknown };
    const typed = router as { stack: StripeWebhookRouterLayer[] };
    const layer = typed.stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');

    const req = {
      headers: { 'stripe-signature': 'test_sig' },
      body: Buffer.from('{}'),
    } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(503);
    expect(res.json).toHaveBeenCalledWith({ error: 'Stripe webhook secret not configured' });
    expect(query).not.toHaveBeenCalled();

    vi.doMock('../../config', () => ({
      config: {
        stripe: {
          secretKey: 'sk_test_abc',
          webhookSecret: 'whsec_test_secret',
          priceIds: { wallet20: 'price_20', wallet50: 'price_50', wallet100: 'price_100' },
        },
      },
    }));
    vi.resetModules();
  });
});
