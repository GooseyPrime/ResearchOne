/**
 * Every price shown to a visitor either reaches Stripe Checkout or is reported
 * as not available. These tests cover the three server rules behind that:
 *
 *  1. `/billing/availability` is public and says which prices can be bought,
 *     without leaking a price id.
 *  2. Buying Living Report tokens needs an eligible plan, checked on the server.
 *  3. A product whose Stripe price setting is missing cannot start a checkout.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ userId: 'user_test' as string | null }));

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (authState.userId) {
        req.auth = {
          userId: authState.userId,
          orgId: null,
          sessionId: null,
          payload: { email: 'test@example.com' },
        };
      }
      next();
    },
  };
});

const stripeMocks = vi.hoisted(() => ({ sessionsCreate: vi.fn() }));

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({ checkout: { sessions: { create: stripeMocks.sessionsCreate } } }),
  };
});

const customerMocks = vi.hoisted(() => ({ getOrCreateStripeCustomer: vi.fn() }));
vi.mock('../services/billing/stripeCustomer', () => customerMocks);

vi.mock('../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));

const viewMocks = vi.hoisted(() => ({ getBillingSubscriptionView: vi.fn() }));
vi.mock('../services/billing/billingSubscriptionView', () => viewMocks);

import request from 'supertest';
import testApp from '../api/app';
import { config } from '../config';

const priceIds = config.stripe.priceIds as Record<string, string>;
const original = { ...priceIds };

function setPrices(overrides: Record<string, string>): void {
  for (const key of Object.keys(priceIds)) priceIds[key] = '';
  Object.assign(priceIds, overrides);
}

const ALL_PRICES = {
  proMonthly: 'price_pro_m',
  proAnnual: 'price_pro_y',
  byokMonthly: 'price_byok_m',
  byokAnnual: 'price_byok_y',
  reverseCitationWatchMonthly: 'price_rcw_m',
  monitorTokenPack1: 'price_tok_1',
  monitorTokenPack5: 'price_tok_5',
  monitorTokenPack10: 'price_tok_10',
};

function userOnTier(effectiveTier: string): void {
  viewMocks.getBillingSubscriptionView.mockResolvedValue({ effectiveTier });
}

beforeEach(() => {
  authState.userId = 'user_test';
  setPrices(ALL_PRICES);
  config.admin.userIds = [];
  stripeMocks.sessionsCreate.mockReset();
  stripeMocks.sessionsCreate.mockResolvedValue({ id: 'cs_test', url: 'https://checkout.stripe.com/test' });
  customerMocks.getOrCreateStripeCustomer.mockReset();
  customerMocks.getOrCreateStripeCustomer.mockResolvedValue('cus_test');
  viewMocks.getBillingSubscriptionView.mockReset();
  userOnTier('pro');
  return () => {
    Object.assign(priceIds, original);
  };
});

describe('GET /api/billing/availability', () => {
  it('answers a signed-out visitor', async () => {
    authState.userId = null;
    const res = await request(testApp).get('/api/billing/availability');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plans: { pro: true, byok: true },
      addons: { living_report: true, reverse_citation_watch: true },
    });
  });

  it('never includes a Stripe price id', async () => {
    authState.userId = null;
    const res = await request(testApp).get('/api/billing/availability');
    expect(JSON.stringify(res.body)).not.toContain('price_');
  });

  it('reports each product whose price setting is missing as not available', async () => {
    authState.userId = null;
    setPrices({ proMonthly: 'price_pro_m' });
    const res = await request(testApp).get('/api/billing/availability');
    expect(res.body).toEqual({
      plans: { pro: true, byok: false },
      addons: { living_report: false, reverse_citation_watch: false },
    });
  });

  it('treats a whitespace-only setting as missing', async () => {
    authState.userId = null;
    setPrices({ byokMonthly: '   ', reverseCitationWatchMonthly: ' ' });
    const res = await request(testApp).get('/api/billing/availability');
    expect(res.body.plans.byok).toBe(false);
    expect(res.body.addons.reverse_citation_watch).toBe(false);
  });

  it('counts a plan with only an annual price as available', async () => {
    authState.userId = null;
    setPrices({ byokAnnual: 'price_byok_y' });
    const res = await request(testApp).get('/api/billing/availability');
    expect(res.body.plans.byok).toBe(true);
  });

  it('leaves the rest of the billing routes behind sign-in', async () => {
    authState.userId = null;
    const res = await request(testApp).get('/api/billing/subscription-options');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/billing/monitor-tokens/checkout — plan eligibility', () => {
  for (const tier of ['free_demo', 'anonymous', 'student', 'wallet']) {
    it(`refuses a ${tier} user and creates nothing in Stripe`, async () => {
      userOnTier(tier);
      const res = await request(testApp)
        .post('/api/billing/monitor-tokens/checkout')
        .send({ packageId: 'pack_5' });

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ADDON_SUBSCRIPTION_REQUIRED');
      expect(res.body.upgradePath).toBe('/app/billing');
      expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
      expect(customerMocks.getOrCreateStripeCustomer).not.toHaveBeenCalled();
    });
  }

  for (const tier of ['pro', 'byok', 'team', 'sovereign']) {
    it(`lets a ${tier} subscriber through to Checkout`, async () => {
      userOnTier(tier);
      const res = await request(testApp)
        .post('/api/billing/monitor-tokens/checkout')
        .send({ packageId: 'pack_5' });

      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBe('https://checkout.stripe.com/test');
      const args = stripeMocks.sessionsCreate.mock.calls[0]?.[0] as {
        mode: string;
        line_items: Array<{ price: string }>;
        metadata: Record<string, string>;
      };
      expect(args.mode).toBe('payment');
      expect(args.line_items[0].price).toBe('price_tok_5');
      // The webhook reads these exact keys to credit the tokens.
      expect(args.metadata).toMatchObject({
        user_id: 'user_test',
        purchase_type: 'monitor_tokens',
        package_id: 'pack_5',
        token_amount: '5',
        price_id: 'price_tok_5',
      });
    });
  }

  it('lets an allowlisted admin through whatever the tier row says', async () => {
    userOnTier('free_demo');
    config.admin.userIds = ['user_test'];
    const res = await request(testApp)
      .post('/api/billing/monitor-tokens/checkout')
      .send({ packageId: 'pack_1' });
    expect(res.status).toBe(200);
  });

  it('requires sign-in', async () => {
    authState.userId = null;
    const res = await request(testApp)
      .post('/api/billing/monitor-tokens/checkout')
      .send({ packageId: 'pack_5' });
    expect(res.status).toBe(401);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });
});

describe('missing price setting', () => {
  it('does not start a token checkout for a pack with no price', async () => {
    setPrices({ ...ALL_PRICES, monitorTokenPack5: '' });
    const res = await request(testApp)
      .post('/api/billing/monitor-tokens/checkout')
      .send({ packageId: 'pack_5' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('ADDON_NOT_AVAILABLE');
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('lists only the token packs that can be bought', async () => {
    setPrices({ monitorTokenPack10: 'price_tok_10' });
    const res = await request(testApp).get('/api/billing/monitor-tokens/packages');
    expect(res.body.packages.map((p: { id: string }) => p.id)).toEqual(['pack_10']);
  });

  it('omits BYOK from the plan options when its price is not set', async () => {
    setPrices({ proMonthly: 'price_pro_m' });
    const res = await request(testApp).get('/api/billing/subscription-options');
    expect(res.body.options.map((o: { tier: string }) => o.tier)).toEqual(['pro']);
  });

  it('refuses a BYOK checkout when the BYOK price is not set', async () => {
    setPrices({ proMonthly: 'price_pro_m' });
    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId: 'price_byok_m', tier: 'byok' });
    expect(res.status).toBe(400);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('marks Living Reports as purchasable in the add-on catalog only when a pack is priced', async () => {
    const find = (body: { addons: Array<{ id: string; stripeConfigured: boolean }> }, id: string) =>
      body.addons.find((a) => a.id === id)?.stripeConfigured;

    let res = await request(testApp).get('/api/billing/addon-catalog');
    expect(find(res.body, 'living_report')).toBe(true);
    expect(find(res.body, 'reverse_citation_watch')).toBe(true);

    setPrices({ proMonthly: 'price_pro_m' });
    res = await request(testApp).get('/api/billing/addon-catalog');
    expect(find(res.body, 'living_report')).toBe(false);
    expect(find(res.body, 'reverse_citation_watch')).toBe(false);
  });
});

describe('POST /api/billing/checkout/subscription — BYOK', () => {
  it('opens a subscription Checkout that carries the byok tier to the webhook', async () => {
    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId: 'price_byok_m', tier: 'byok' });

    expect(res.status).toBe(200);
    const args = stripeMocks.sessionsCreate.mock.calls[0]?.[0] as {
      mode: string;
      line_items: Array<{ price: string }>;
      subscription_data: { metadata: Record<string, string> };
    };
    expect(args.mode).toBe('subscription');
    expect(args.line_items[0].price).toBe('price_byok_m');
    expect(args.subscription_data.metadata).toMatchObject({ user_id: 'user_test', tier: 'byok' });
  });

  it('refuses a byok price sent with another tier name', async () => {
    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId: 'price_byok_m', tier: 'pro' });
    expect(res.status).toBe(400);
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });
});
