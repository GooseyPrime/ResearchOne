/**
 * POST /api/billing/subscription/switch — a subscriber moves between Pro and
 * BYOK (monthly or annual).
 *
 * The rules under test:
 *  - the existing subscription's one item is moved to the new price, with
 *    proration; Checkout is never opened and no subscription is created;
 *  - only Pro and BYOK prices are accepted as the target;
 *  - the plan and billing period the customer already has is refused;
 *  - the subscription changed is always the signed-in user's own.
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

const stripeMocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsCreate: vi.fn(),
  sessionsCreate: vi.fn(),
}));

const PRICE_TIERS: Record<string, string> = {
  price_pro_m: 'pro',
  price_pro_y: 'pro',
  price_byok_m: 'byok',
  price_byok_y: 'byok',
  price_team_m: 'team',
  price_student_m: 'student',
};

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: {
        retrieve: stripeMocks.subscriptionsRetrieve,
        update: stripeMocks.subscriptionsUpdate,
        create: stripeMocks.subscriptionsCreate,
      },
      checkout: { sessions: { create: stripeMocks.sessionsCreate } },
    }),
    getTierForSubscriptionPrice: (priceId: string) => PRICE_TIERS[priceId] ?? null,
  };
});

const subscriptionMocks = vi.hoisted(() => ({ getUserSubscription: vi.fn() }));
vi.mock('../services/billing/subscriptionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing/subscriptionService')>()),
  getUserSubscription: subscriptionMocks.getUserSubscription,
}));

// Only customer → user lookups are faked; the ownership decision itself runs for real.
const customerMocks = vi.hoisted(() => ({
  lookupUserIdByStripeCustomerId: vi.fn(),
  getOrCreateStripeCustomer: vi.fn(),
}));
vi.mock('../services/billing/stripeCustomer', () => customerMocks);

import request from 'supertest';
import testApp from '../api/app';

type LocalRow = {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
};

function localRow(overrides: Partial<LocalRow> = {}): LocalRow {
  return {
    tier: 'pro',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    stripeSubscriptionId: 'sub_mine',
    ...overrides,
  };
}

function stripeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_mine',
    customer: 'cus_mine',
    status: 'active',
    cancel_at_period_end: false,
    metadata: { user_id: 'user_test', tier: 'pro' },
    items: { data: [{ id: 'si_plan', price: { id: 'price_pro_m' } }] },
    ...overrides,
  };
}

function switchTo(body: Record<string, unknown>) {
  return request(testApp).post('/api/billing/subscription/switch').send(body);
}

beforeEach(() => {
  authState.userId = 'user_test';
  for (const mock of Object.values(stripeMocks)) mock.mockReset();
  stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription());
  stripeMocks.subscriptionsUpdate.mockResolvedValue({ id: 'sub_mine' });
  subscriptionMocks.getUserSubscription.mockReset().mockResolvedValue(localRow());
  customerMocks.lookupUserIdByStripeCustomerId.mockReset().mockResolvedValue(null);
});

describe('switching plans changes the existing subscription', () => {
  it('moves the existing item to the new price and never creates a subscription or a checkout', async () => {
    const res = await switchTo({ priceId: 'price_byok_m' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ switched: true, tier: 'byok' });

    expect(stripeMocks.subscriptionsUpdate).toHaveBeenCalledTimes(1);
    const [subscriptionId, params] = stripeMocks.subscriptionsUpdate.mock.calls[0] as [
      string,
      { items: Array<Record<string, unknown>> },
    ];
    expect(subscriptionId).toBe('sub_mine');
    // The item id is what makes this a change of the existing line. Without
    // it Stripe would add a second line and bill both prices.
    expect(params.items).toEqual([{ id: 'si_plan', price: 'price_byok_m' }]);

    expect(stripeMocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
  });

  it('asks Stripe to prorate the difference', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    const params = stripeMocks.subscriptionsUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params.proration_behavior).toBe('create_prorations');
  });

  it('renames the plan kept on the subscription so the webhook cannot fall back to the old one', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    const params = stripeMocks.subscriptionsUpdate.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(params.metadata).toEqual({ tier: 'byok' });
  });

  it('allows a change of billing period on the same plan', async () => {
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
    const params = stripeMocks.subscriptionsUpdate.mock.calls[0]?.[1] as { items: unknown };
    expect(params.items).toEqual([{ id: 'si_plan', price: 'price_pro_y' }]);
  });
});

describe('only Pro and BYOK can be switched to', () => {
  it.each([
    ['a Team price', 'price_team_m'],
    ['a Student price', 'price_student_m'],
    ['a price this deployment does not sell', 'price_unknown'],
  ])('refuses %s', async (_label, priceId) => {
    const res = await switchTo({ priceId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PLAN_SWITCH_TARGET_NOT_ALLOWED');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a request with no price', async () => {
    const res = await switchTo({});
    expect(res.status).toBe(400);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a Team subscriber, whose plan is not self-serve', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ tier: 'team' }));
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_CURRENT_PLAN_NOT_SELF_SERVE');
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the subscription in Stripe is on a Team price, whatever our own row says', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ items: { data: [{ id: 'si_plan', price: { id: 'price_team_m' } }] } }),
    );
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe('switching to the plan the customer already has is refused', () => {
  it('refuses the same plan and billing period', async () => {
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_ALREADY_ON_PRICE');
    expect(res.body.error).toBe('You are already on this plan and billing period.');
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe('a user can only switch their own subscription', () => {
  it('ignores a subscription id sent in the request and uses the signed-in user’s own', async () => {
    const res = await switchTo({
      priceId: 'price_byok_m',
      subscriptionId: 'sub_someone_else',
      stripeSubscriptionId: 'sub_someone_else',
      userId: 'user_other',
    });

    expect(res.status).toBe(200);
    expect(subscriptionMocks.getUserSubscription).toHaveBeenCalledWith('user_test');
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_mine');
    expect(stripeMocks.subscriptionsUpdate.mock.calls[0]?.[0]).toBe('sub_mine');
  });

  it('refuses when Stripe says the subscription belongs to another user', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { user_id: 'user_other', tier: 'pro' } }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_SWITCH_NOT_OWNER');
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the subscription’s customer is another user’s', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ customer: { id: 'cus_other' }, metadata: {} }),
    );
    customerMocks.lookupUserIdByStripeCustomerId.mockResolvedValue('user_other');
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses when the owner cannot be established at all', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ customer: { id: 'cus_unknown' }, metadata: {} }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    authState.userId = null;
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(401);
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe('subscriptions that are not switched', () => {
  it('sends a user with no subscription to subscribe instead, touching nothing in Stripe', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(
      localRow({ tier: 'free_demo', status: 'inactive', stripeSubscriptionId: null }),
    );
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_NO_ACTIVE_SUBSCRIPTION');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a canceled subscription', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ status: 'canceled' }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a subscription that is set to end', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at_period_end: true }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_ENDING_SUBSCRIPTION');
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses an add-on subscription', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { user_id: 'user_test', monitor_kind: 'living_report' } }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses a subscription with more than one line', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        items: {
          data: [
            { id: 'si_plan', price: { id: 'price_pro_m' } },
            { id: 'si_extra', price: { id: 'price_other' } },
          ],
        },
      }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});
