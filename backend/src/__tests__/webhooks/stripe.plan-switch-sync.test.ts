/**
 * A plan switch from start to finish: the subscriber calls the switch route,
 * Stripe (faked) applies the change and sends `customer.subscription.updated`,
 * and the webhook's existing sync sets the account's plan.
 *
 * The event is built from what the switch route actually sent to Stripe, so
 * these tests fail if the route is removed or stops moving the price. The
 * route itself writes nothing to our tables; the plan changes only when the
 * event is handled, and handling the same event twice writes once.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      req.auth = { userId: 'user_test', orgId: null, sessionId: null, payload: { email: 'test@example.com' } };
      next();
    },
  };
});

type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata: Record<string, string>;
  items: { data: Array<{ id: string; price: { id: string; lookup_key: null } }> };
};

const world = vi.hoisted(() => ({
  /** The subscription as Stripe holds it. */
  stripeSubscription: null as unknown,
  /** Our `user_subscriptions` row for the test user. */
  localRow: null as unknown,
  subscriptionWrites: 0,
  tierWrites: [] as string[],
  billingEvents: [] as string[],
  processedEvents: new Set<string>(),
  nextEvent: null as unknown,
}));

function stripeSub(): FakeSubscription {
  return world.stripeSubscription as FakeSubscription;
}
function localRow(): { tier: string; status: string; stripe_subscription_id: string } {
  return world.localRow as { tier: string; status: string; stripe_subscription_id: string };
}

const PRICE_TIERS: Record<string, string> = {
  price_pro_m: 'pro',
  price_pro_y: 'pro',
  price_byok_m: 'byok',
  price_byok_y: 'byok',
};

vi.mock('../../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: {
        retrieve: async () => world.stripeSubscription,
        // Applies the change the way Stripe does: the named item takes the new
        // price and the given metadata keys are merged in.
        update: async (
          _id: string,
          params: { items: Array<{ id: string; price: string }>; metadata?: Record<string, string> },
        ) => {
          const sub = world.stripeSubscription as FakeSubscription;
          for (const change of params.items) {
            const item = sub.items.data.find((i) => i.id === change.id);
            if (!item) throw new Error('fake Stripe: an item was added instead of changed');
            item.price = { id: change.price, lookup_key: null };
          }
          sub.metadata = { ...sub.metadata, ...(params.metadata ?? {}) };
          return sub;
        },
      },
      webhooks: { constructEvent: () => world.nextEvent },
    }),
    getTierForSubscriptionPrice: (priceId: string) => PRICE_TIERS[priceId] ?? null,
  };
});

vi.mock('../../db/pool', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../db/pool')>();
  return {
    ...actual,
    queryOne: async (sql: string) => (sql.includes('FROM user_subscriptions') ? world.localRow : null),
    query: async (sql: string, params: unknown[] = []) => {
      if (sql.includes('INSERT INTO stripe_webhook_events')) {
        const id = String(params[0]);
        return world.processedEvents.has(id) ? [] : [{ stripe_event_id: id }];
      }
      if (sql.includes('SELECT processed_at FROM stripe_webhook_events')) {
        return world.processedEvents.has(String(params[0])) ? [{ processed_at: '2026-10-08T00:00:00Z' }] : [];
      }
      if (sql.includes('UPDATE stripe_webhook_events SET processed_at')) {
        world.processedEvents.add(String(params[0]));
        return [];
      }
      if (sql.includes('INSERT INTO user_subscriptions')) {
        world.subscriptionWrites += 1;
        world.localRow = {
          ...(world.localRow as Record<string, unknown>),
          tier: String(params[1]),
          status: String(params[2]),
          stripe_subscription_id: String(params[4]),
        };
        return [];
      }
      if (sql.includes('billing_events')) {
        world.billingEvents.push(params.map(String).find((p) => p.startsWith('Subscription')) ?? '');
        return [];
      }
      return [];
    },
  };
});

vi.mock('../../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tier/tierService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/tier/tierService')>()),
  setUserTier: async (_userId: string, tier: string) => {
    world.tierWrites.push(tier);
  },
}));
vi.mock('../../services/billing/stripeCustomer', () => ({
  lookupUserIdByStripeCustomerId: vi.fn().mockResolvedValue(null),
  getOrCreateStripeCustomer: vi.fn().mockResolvedValue('cus_mine'),
}));

import request from 'supertest';
import testApp from '../../api/app';
import { config } from '../../config';

const originalWebhookSecret = config.stripe.webhookSecret;
const originalSecretKey = config.stripe.secretKey;

beforeEach(() => {
  world.stripeSubscription = {
    id: 'sub_mine',
    customer: 'cus_mine',
    status: 'active',
    current_period_end: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000),
    cancel_at_period_end: false,
    metadata: { user_id: 'user_test', tier: 'pro' },
    items: { data: [{ id: 'si_plan', price: { id: 'price_pro_m', lookup_key: null } }] },
  } satisfies FakeSubscription;
  world.localRow = {
    tier: 'pro',
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: '2026-11-01T00:00:00.000Z',
    stripe_subscription_id: 'sub_mine',
  };
  world.subscriptionWrites = 0;
  world.tierWrites = [];
  world.billingEvents = [];
  world.processedEvents = new Set<string>();
  world.nextEvent = null;
  config.stripe.webhookSecret = 'whsec_test';
  config.stripe.secretKey = 'sk_test_x';
  return () => {
    config.stripe.webhookSecret = originalWebhookSecret;
    config.stripe.secretKey = originalSecretKey;
  };
});

function switchTo(priceId: string) {
  return request(testApp).post('/api/billing/subscription/switch').send({ priceId });
}

/** Stripe's `customer.subscription.updated`, carrying the subscription as Stripe now holds it. */
function deliverSubscriptionUpdated(eventId: string) {
  world.nextEvent = {
    id: eventId,
    type: 'customer.subscription.updated',
    data: { object: JSON.parse(JSON.stringify(world.stripeSubscription)) as FakeSubscription },
  };
  return request(testApp)
    .post('/api/webhooks/stripe')
    .set('stripe-signature', 'valid_sig')
    .set('Content-Type', 'application/json')
    .send('{}');
}

describe('a plan switch, from the switch route to the account plan', () => {
  it('the route changes Stripe only; the plan changes when the event is handled', async () => {
    const switched = await switchTo('price_byok_m');
    expect(switched.status).toBe(200);

    // Stripe now holds the new price on the same single item.
    expect(stripeSub().items.data).toEqual([{ id: 'si_plan', price: { id: 'price_byok_m', lookup_key: null } }]);
    // Our own tables are untouched until Stripe's event arrives.
    expect(world.subscriptionWrites).toBe(0);
    expect(world.tierWrites).toEqual([]);
    expect(localRow().tier).toBe('pro');

    const delivered = await deliverSubscriptionUpdated('evt_switch_1');
    expect(delivered.status).toBe(200);
    expect(delivered.body).toEqual({ status: 'processed' });

    expect(localRow().tier).toBe('byok');
    expect(localRow().stripe_subscription_id).toBe('sub_mine');
    expect(world.tierWrites).toEqual(['byok']);
    expect(world.billingEvents).toEqual(['Subscription updated · byok']);
  });

  it('writes the plan once when Stripe delivers the same event twice', async () => {
    await switchTo('price_byok_m');

    const first = await deliverSubscriptionUpdated('evt_switch_1');
    const second = await deliverSubscriptionUpdated('evt_switch_1');

    expect(first.body).toEqual({ status: 'processed' });
    expect(second.body).toEqual({ status: 'already_processed' });
    expect(world.subscriptionWrites).toBe(1);
    expect(world.tierWrites).toEqual(['byok']);
    expect(world.billingEvents).toHaveLength(1);
  });

  it.each([
    ['price_pro_y', 'pro'],
    ['price_byok_m', 'byok'],
    ['price_byok_y', 'byok'],
  ])('switching to %s leaves the account on the %s plan', async (priceId, tier) => {
    await switchTo(priceId);
    await deliverSubscriptionUpdated(`evt_${priceId}`);
    expect(localRow().tier).toBe(tier);
    expect(world.tierWrites).toEqual([tier]);
  });

  it('the plan follows the price even if the plan name on the subscription were stale', async () => {
    await switchTo('price_byok_m');
    stripeSub().metadata.tier = 'pro';
    await deliverSubscriptionUpdated('evt_switch_stale');
    expect(localRow().tier).toBe('byok');
  });

  it('a second switch back is followed too', async () => {
    await switchTo('price_byok_m');
    await deliverSubscriptionUpdated('evt_a');
    const back = await switchTo('price_pro_m');
    expect(back.status).toBe(200);
    await deliverSubscriptionUpdated('evt_b');
    expect(localRow().tier).toBe('pro');
    expect(world.tierWrites).toEqual(['byok', 'pro']);
  });
});
