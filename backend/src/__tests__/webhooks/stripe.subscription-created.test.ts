/**
 * Tests: Webhook for customer.subscription.created → user_subscriptions row inserted,
 *        user_tiers.tier updated to match
 *
 * Per Rule 16: These tests MUST fail without the fix (subscription sync handler).
 */

import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const queryOne = vi.fn();
const constructEvent = vi.fn();

vi.mock('../../db/pool', () => ({ query, queryOne }));
vi.mock('../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_abc',
      webhookSecret: 'whsec_test_secret',
      priceIds: {
        studentMonthly: 'price_student_monthly',
        proMonthly: 'price_pro_monthly',
        teamSeatMonthly: 'price_team_monthly',
        byokMonthly: 'price_byok_monthly',
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

describe('stripe webhook customer.subscription.created', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('syncs subscription with student tier', async () => {
    const eventId = 'evt_sub_created_student';
    const subscriptionId = 'sub_student_123';
    const customerId = 'cus_student_123';
    const userId = 'user_student_123';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: { user_id: userId },
          items: {
            data: [{ price: { lookup_key: 'student_monthly' } }],
          },
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

    const upsertCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO user_subscriptions')
    );
    expect(upsertCall).toBeDefined();
    if (upsertCall) {
      expect(upsertCall[1]).toContain(userId);
      expect(upsertCall[1]).toContain('student');
      expect(upsertCall[1]).toContain('active');
      expect(upsertCall[1]).toContain(customerId);
      expect(upsertCall[1]).toContain(subscriptionId);
    }
  });

  it('syncs subscription with pro tier', async () => {
    const eventId = 'evt_sub_created_pro';
    const subscriptionId = 'sub_pro_123';
    const customerId = 'cus_pro_123';
    const userId = 'user_pro_123';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: { user_id: userId },
          items: {
            data: [{ price: { lookup_key: 'pro_monthly' } }],
          },
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

    const upsertCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO user_subscriptions')
    );
    expect(upsertCall).toBeDefined();
    if (upsertCall) {
      expect(upsertCall[1]).toContain('pro');
    }
  });

  it('syncs subscription updated event', async () => {
    const eventId = 'evt_sub_updated';
    const subscriptionId = 'sub_updated_123';
    const customerId = 'cus_updated_123';
    const userId = 'user_updated_123';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: subscriptionId,
          customer: customerId,
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: true,
          metadata: { user_id: userId },
          items: {
            data: [{ price: { lookup_key: 'team_monthly' } }],
          },
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

    const upsertCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO user_subscriptions')
    );
    expect(upsertCall).toBeDefined();
    if (upsertCall) {
      expect(upsertCall[1]).toContain('team');
      expect(upsertCall[1]).toContain(true);
    }
  });

  it('marks subscription deleted', async () => {
    const eventId = 'evt_sub_deleted';
    const subscriptionId = 'sub_deleted_123';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: subscriptionId,
          customer: 'cus_deleted_123',
          status: 'canceled',
          current_period_end: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
          metadata: { user_id: 'user_deleted_123' },
          items: {
            data: [{ price: { lookup_key: 'pro_monthly' } }],
          },
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

    const cancelCall = query.mock.calls.find((call) =>
      typeof call[0] === 'string' && call[0].includes("SET status = 'canceled'")
    );
    expect(cancelCall).toBeDefined();
    if (cancelCall) {
      expect(cancelCall[1]).toContain(subscriptionId);
    }
  });

  it('handles missing user_id in subscription metadata', async () => {
    const eventId = 'evt_sub_no_user';
    const subscriptionId = 'sub_no_user_123';

    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);
    query.mockResolvedValueOnce([]);

    constructEvent.mockReturnValueOnce({
      id: eventId,
      type: 'customer.subscription.created',
      data: {
        object: {
          id: subscriptionId,
          customer: 'cus_no_user',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
          cancel_at_period_end: false,
          metadata: {},
          items: {
            data: [{ price: { lookup_key: 'pro_monthly' } }],
          },
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

    const upsertCalls = query.mock.calls.filter((call) =>
      typeof call[0] === 'string' && call[0].includes('INSERT INTO user_subscriptions')
    );
    expect(upsertCalls.length).toBe(0);
  });
});
