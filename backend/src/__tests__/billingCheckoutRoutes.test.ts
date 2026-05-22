/**
 * Billing checkout routes — assert Stripe Session create uses expected
 * promotion-code defaults.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.auth = {
        userId: 'user_test',
        orgId: null,
        sessionId: null,
        payload: { email: 'test@example.com' },
      };
      next();
    },
  };
});

const stripeMocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
}));

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: { sessions: { create: stripeMocks.sessionsCreate } },
    }),
    getTopupAmountForPrice: (priceId: string) => (priceId === 'price_wallet_20' ? 2000 : null),
    getSubscriptionPriceOptions: () => [],
    getTierForSubscriptionPrice: (priceId: string) => (priceId === 'price_pro_monthly' ? 'pro' : null),
  };
});

vi.mock('../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/billing/stripeCustomer', () => ({
  getOrCreateStripeCustomer: vi.fn().mockResolvedValue('cus_test'),
}));

import request from 'supertest';
import testApp from '../api/app';

beforeEach(() => {
  stripeMocks.sessionsCreate.mockReset();
  stripeMocks.sessionsCreate.mockResolvedValue({
    id: 'cs_test',
    url: 'https://checkout.stripe.com/test',
  });
});

describe('POST /api/billing/checkout/subscription', () => {
  it('creates subscription Checkout with if_required payment method collection', async () => {
    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId: 'price_pro_monthly', tier: 'pro' });

    expect(res.status).toBe(200);
    expect(stripeMocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const createArgs = stripeMocks.sessionsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.mode).toBe('subscription');
    expect(createArgs.payment_method_collection).toBe('if_required');
    expect(createArgs.allow_promotion_codes).toBe(true);
    expect(createArgs.customer).toBe('cus_test');
  });
});

describe('POST /api/billing/checkout/topup', () => {
  it('creates payment Checkout with promotion codes enabled', async () => {
    const res = await request(testApp)
      .post('/api/billing/checkout/topup')
      .send({ priceId: 'price_wallet_20' });

    expect(res.status).toBe(200);
    expect(stripeMocks.sessionsCreate).toHaveBeenCalledTimes(1);
    const createArgs = stripeMocks.sessionsCreate.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(createArgs.mode).toBe('payment');
    expect(createArgs.payment_method_collection).toBeUndefined();
    expect(createArgs.allow_promotion_codes).toBe(true);
  });
});
