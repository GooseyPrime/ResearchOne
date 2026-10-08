/**
 * Team and Sovereign are not sold. The pages no longer offer them; these tests
 * hold the server to the same rule, so a request made by hand, or a Team price
 * id still sitting in the settings, cannot buy one or switch to one.
 *
 * The tier names themselves stay valid (existing accounts keep working).
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
        req.auth = { userId: authState.userId, orgId: null, sessionId: null, payload: { email: 'test@example.com' } };
      }
      next();
    },
  };
});

const stripeMocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsCreate: vi.fn(),
  schedulesCreate: vi.fn(),
  schedulesUpdate: vi.fn(),
}));

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: { sessions: { create: stripeMocks.sessionsCreate } },
      subscriptions: {
        retrieve: stripeMocks.subscriptionsRetrieve,
        update: stripeMocks.subscriptionsUpdate,
        create: stripeMocks.subscriptionsCreate,
      },
      subscriptionSchedules: { create: stripeMocks.schedulesCreate, update: stripeMocks.schedulesUpdate },
    }),
  };
});

const customerMocks = vi.hoisted(() => ({
  getOrCreateStripeCustomer: vi.fn(),
  lookupUserIdByStripeCustomerId: vi.fn(),
}));
vi.mock('../services/billing/stripeCustomer', () => customerMocks);
vi.mock('../services/users/ensureUserRow', () => ({ ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined) }));

const subscriptionMocks = vi.hoisted(() => ({ getUserSubscription: vi.fn() }));
vi.mock('../services/billing/subscriptionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing/subscriptionService')>()),
  getUserSubscription: subscriptionMocks.getUserSubscription,
}));

import request from 'supertest';
import testApp from '../api/app';
import { config } from '../config';
import { isTierName, TIER_RULES } from '../config/tierRules';
import { ADDON_SUBSCRIPTION_REQUIRED_MESSAGE, tierIsAddonEligible } from '../services/billing/addonEligibility';
import { getSubscriptionPriceOptions, isRemovedPlanTier, isSelfServeSubscriptionTier } from '../services/billing/stripeClient';
import { getAddonCatalog } from '../services/billing/addonCatalog';

const priceIds = config.stripe.priceIds as Record<string, string>;
const original = { ...priceIds };
const originalSecretKey = config.stripe.secretKey;

function nothingReachedStripe(): void {
  for (const mock of Object.values(stripeMocks)) expect(mock).not.toHaveBeenCalled();
}

beforeEach(() => {
  authState.userId = 'user_test';
  for (const key of Object.keys(priceIds)) priceIds[key] = original[key] ?? '';
  Object.assign(priceIds, {
    proMonthly: 'price_pro_m',
    proAnnual: 'price_pro_y',
    byokMonthly: 'price_byok_m',
    byokAnnual: 'price_byok_y',
    // Left in the settings on purpose: the rule must hold even so.
    teamSeatMonthly: 'price_team_m',
    teamSeatAnnual: 'price_team_y',
  });
  config.stripe.secretKey = originalSecretKey || 'sk_test_placeholder';
  for (const mock of Object.values(stripeMocks)) mock.mockReset();
  stripeMocks.sessionsCreate.mockResolvedValue({ id: 'cs_1', url: 'https://checkout.example/cs_1' });
  customerMocks.getOrCreateStripeCustomer.mockReset().mockResolvedValue('cus_mine');
  customerMocks.lookupUserIdByStripeCustomerId.mockReset().mockResolvedValue(null);
  subscriptionMocks.getUserSubscription.mockReset().mockResolvedValue({
    tier: 'pro',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    stripeSubscriptionId: 'sub_mine',
  });
});

describe('checkout refuses Team and Sovereign', () => {
  it.each([
    ['Team, with a real Team price', { tier: 'team', priceId: 'price_team_m' }],
    ['Team, annual', { tier: 'team', priceId: 'price_team_y' }],
    ['Team, spelled with a capital', { tier: 'Team', priceId: 'price_team_m' }],
    ['a Team price sent under the Pro name', { tier: 'pro', priceId: 'price_team_m' }],
    ['Team, under a Pro price', { tier: 'team', priceId: 'price_pro_m' }],
    ['Sovereign, under a Pro price', { tier: 'sovereign', priceId: 'price_pro_m' }],
    ['Sovereign, with a price that is not ours', { tier: 'sovereign', priceId: 'price_unknown' }],
  ])('refuses %s and opens no checkout', async (_label, body) => {
    const res = await request(testApp).post('/api/billing/checkout/subscription').send(body);
    expect(res.status).toBe(409);
    expect(res.body).toEqual({ error: 'That plan is not available.', code: 'PLAN_NOT_AVAILABLE' });
    expect(res.body.checkoutUrl).toBeUndefined();
    nothingReachedStripe();
  });

  it('still sells Pro and BYOK', async () => {
    for (const body of [{ tier: 'pro', priceId: 'price_pro_m' }, { tier: 'byok', priceId: 'price_byok_m' }]) {
      const res = await request(testApp).post('/api/billing/checkout/subscription').send(body);
      expect(res.status).toBe(200);
      expect(res.body.checkoutUrl).toBe('https://checkout.example/cs_1');
    }
  });
});

describe('the plan-switch route refuses Team and Sovereign', () => {
  it.each([
    ['a Team monthly price', 'price_team_m'],
    ['a Team annual price', 'price_team_y'],
  ])('refuses %s as the plan to move to', async (_label, priceId) => {
    const res = await request(testApp).post('/api/billing/subscription/switch').send({ priceId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PLAN_SWITCH_TARGET_NOT_ALLOWED');
    nothingReachedStripe();
  });

  it('has no price at all that leads to Sovereign', () => {
    for (const priceId of Object.values(priceIds).filter(Boolean)) {
      expect(isSelfServeSubscriptionTier('sovereign')).toBe(false);
      expect(priceId).not.toMatch(/sovereign/i);
    }
  });

  it.each(['team', 'sovereign'])('does not move an account that is on %s', async (tier) => {
    subscriptionMocks.getUserSubscription.mockResolvedValue({
      tier,
      status: 'active',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: '2026-11-01T00:00:00.000Z',
      stripeSubscriptionId: 'sub_mine',
    });
    const res = await request(testApp).post('/api/billing/subscription/switch').send({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_CURRENT_PLAN_NOT_SELF_SERVE');
    nothingReachedStripe();
  });
});

describe('what the server lists for sale', () => {
  it('offers Pro and BYOK only, even with Team prices configured', async () => {
    expect(getSubscriptionPriceOptions().map((option) => option.tier)).toEqual(['pro', 'byok']);
    const res = await request(testApp).get('/api/billing/subscription-options');
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/team|sovereign|seat/i);
  });

  it('says add-ons need Pro or BYOK, and names no other plan', () => {
    expect(ADDON_SUBSCRIPTION_REQUIRED_MESSAGE).toBe('Add-ons require an active Pro or BYOK subscription');
  });

  it('the add-on list sent to the app names no removed offer', () => {
    expect(JSON.stringify(getAddonCatalog())).not.toMatch(/\bteam\b|sovereign|enterprise|seat|devil|intellme\.com/i);
  });
});

describe('existing accounts are untouched', () => {
  it('keeps team and sovereign as valid tiers with their rules and add-on access', () => {
    for (const tier of ['team', 'sovereign']) {
      expect(isTierName(tier)).toBe(true);
      expect(TIER_RULES[tier as 'team' | 'sovereign']).toBeDefined();
      expect(tierIsAddonEligible(tier)).toBe(true);
      expect(isRemovedPlanTier(tier)).toBe(true);
    }
    expect(isRemovedPlanTier('pro')).toBe(false);
    expect(isRemovedPlanTier('byok')).toBe(false);
  });
});

describe('the InTellMe integration is off unless its address is set', () => {
  it('has no built-in address and refuses to call out without INTELLME_API_URL', async () => {
    const saved = process.env.INTELLME_API_URL;
    delete process.env.INTELLME_API_URL;
    process.env.INTELLME_API_KEY = 'k';
    process.env.INTELLME_API_SECRET = 's';
    vi.resetModules();
    try {
      const { intellmeClient } = await import('../services/ingestion/intellmeClient');
      await expect(intellmeClient.query({ userId: 'u1', query: 'q' })).rejects.toThrow('InTellMe client is off: INTELLME_API_URL is not set');
      await expect(intellmeClient.ingest({ userId: 'u1', documentId: 'd1', content: 'c' })).rejects.toThrow('INTELLME_API_URL is not set');
      await expect(intellmeClient.delete({ userId: 'u1', documentId: 'd1' })).rejects.toThrow('INTELLME_API_URL is not set');
    } finally {
      if (saved === undefined) delete process.env.INTELLME_API_URL;
      else process.env.INTELLME_API_URL = saved;
      delete process.env.INTELLME_API_KEY;
      delete process.env.INTELLME_API_SECRET;
    }
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const source = readFileSync(join(__dirname, '../services/ingestion/intellmeClient.ts'), 'utf8');
    expect(source).not.toMatch(/intellme\.com/i);
  });
});
