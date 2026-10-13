/**
 * A plan change from start to finish: the subscriber asks for it, Stripe
 * (faked) holds it in a subscription schedule until the billing period ends,
 * then moves the subscription to the new price and sends
 * `customer.subscription.updated`; the webhook's existing sync sets the plan.
 *
 * The fake applies exactly the phases the route sent, so these tests fail if
 * the route stops scheduling, changes the price straight away, or leaves the
 * old plan name on the next phase. The route itself writes nothing to our
 * tables: the plan in the app changes only when the new phase has started
 * and its event is handled, and handling the same event twice writes once.
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

type FakePhase = {
  start_date: number;
  end_date: number;
  trial_end: null;
  discounts: [];
  items: Array<{ price: string; quantity: number }>;
  metadata?: Record<string, string>;
  proration_behavior?: string;
};
type FakeSchedule = {
  id: string;
  status: 'active' | 'released';
  subscription: string;
  metadata: Record<string, string>;
  end_behavior?: string;
  current_phase: { start_date: number; end_date: number };
  phases: FakePhase[];
};
type FakeSubscription = {
  id: string;
  customer: string;
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  schedule: string | null;
  metadata: Record<string, string>;
  items: { data: Array<{ id: string; quantity: number; price: { id: string; lookup_key: null } }> };
};

const MONTH = 31 * 86400;

const world = vi.hoisted(() => ({
  /** The subscription as Stripe holds it. */
  stripeSubscription: null as unknown,
  /** The schedule attached to it, once a change has been asked for. */
  schedule: null as unknown,
  /** Direct updates to the subscription. A scheduled change makes none. */
  directUpdates: 0,
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
function schedule(): FakeSchedule | null {
  return world.schedule as FakeSchedule | null;
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
        retrieve: async () => {
          const sub = world.stripeSubscription as FakeSubscription;
          const attached = world.schedule as FakeSchedule | null;
          // Asked for with `expand: ['schedule']`, as the route does.
          return { ...sub, schedule: attached && attached.status === 'active' ? attached : null };
        },
        update: async () => {
          world.directUpdates += 1;
          throw new Error('fake Stripe: the subscription was updated directly instead of being scheduled');
        },
      },
      subscriptionSchedules: {
        // Stripe copies the subscription as it stands into one phase: the current period.
        create: async (params: { from_subscription: string }) => {
          const sub = world.stripeSubscription as FakeSubscription;
          if (params.from_subscription !== sub.id) throw new Error('fake Stripe: unknown subscription');
          const start = sub.current_period_end - MONTH;
          const made: FakeSchedule = {
            id: 'sub_sched_1',
            status: 'active',
            subscription: sub.id,
            metadata: {},
            current_phase: { start_date: start, end_date: sub.current_period_end },
            phases: [
              {
                start_date: start,
                end_date: sub.current_period_end,
                trial_end: null,
                discounts: [],
                items: sub.items.data.map((item) => ({ price: item.price.id, quantity: item.quantity })),
              },
            ],
          };
          world.schedule = made;
          sub.schedule = made.id;
          return made;
        },
        // Stores the phases as sent. A phase with no dates follows the one before it.
        update: async (
          _id: string,
          params: {
            end_behavior?: string;
            metadata?: Record<string, string>;
            phases: Array<{
              items: Array<{ price: string; quantity: number }>;
              start_date?: number;
              end_date?: number;
              metadata?: Record<string, string>;
              proration_behavior?: string;
            }>;
          },
        ) => {
          const held = world.schedule as FakeSchedule;
          let cursor = held.current_phase.start_date;
          held.phases = params.phases.map((phase) => {
            const start = phase.start_date ?? cursor;
            const end = phase.end_date ?? start + MONTH;
            cursor = end;
            return { start_date: start, end_date: end, trial_end: null, discounts: [], items: phase.items, metadata: phase.metadata, proration_behavior: phase.proration_behavior };
          });
          held.metadata = { ...held.metadata, ...(params.metadata ?? {}) };
          held.end_behavior = params.end_behavior;
          return held;
        },
        release: async () => {
          const held = world.schedule as FakeSchedule;
          held.status = 'released';
          (world.stripeSubscription as FakeSubscription).schedule = null;
          return held;
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
const planPriceIds = config.stripe.priceIds as Record<string, string>;
const originalPlanPriceIds = { ...planPriceIds };

beforeEach(() => {
  world.stripeSubscription = {
    id: 'sub_mine',
    customer: 'cus_mine',
    status: 'active',
    current_period_end: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000),
    cancel_at_period_end: false,
    schedule: null,
    metadata: { user_id: 'user_test', tier: 'pro' },
    items: { data: [{ id: 'si_plan', quantity: 1, price: { id: 'price_pro_m', lookup_key: null } }] },
  } satisfies FakeSubscription;
  world.schedule = null;
  world.directUpdates = 0;
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
  // The webhook only acts on prices this deployment sells.
  Object.assign(planPriceIds, {
    proMonthly: 'price_pro_m',
    proAnnual: 'price_pro_y',
    byokMonthly: 'price_byok_m',
    byokAnnual: 'price_byok_y',
  });
  return () => {
    Object.assign(planPriceIds, originalPlanPriceIds);
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

/**
 * The billing period ends. Stripe starts the schedule's next phase the way it
 * does for real: the subscription's item takes that phase's price, the
 * phase's metadata is merged into the subscription's, and the period moves on.
 */
function billingPeriodEnds(): void {
  const held = schedule();
  if (!held || held.status !== 'active') return;
  const next = held.phases.find((phase) => phase.start_date >= held.current_phase.end_date);
  if (!next) return;
  const sub = stripeSub();
  const item = sub.items.data[0];
  const priced = next.items[0];
  if (!item || !priced) throw new Error('fake Stripe: a phase with no item');
  item.price = { id: priced.price, lookup_key: null };
  sub.metadata = { ...sub.metadata, ...(next.metadata ?? {}) };
  sub.current_period_end = next.end_date;
  held.current_phase = { start_date: next.start_date, end_date: next.end_date };
}

const PERIOD_END_ISO = '2026-11-01T00:00:00.000Z';

describe('a scheduled plan change, from the switch route to the account plan', () => {
  it('asking changes nothing yet: same price in Stripe, same plan in the app', async () => {
    const asked = await switchTo('price_byok_m');
    expect(asked.status).toBe(200);
    expect(asked.body.pendingChange).toEqual({ tier: 'byok', billingPeriod: 'monthly', effectiveAt: PERIOD_END_ISO });

    // Stripe still bills the old price on the same single item.
    expect(stripeSub().items.data).toEqual([{ id: 'si_plan', quantity: 1, price: { id: 'price_pro_m', lookup_key: null } }]);
    expect(stripeSub().metadata.tier).toBe('pro');
    expect(world.directUpdates).toBe(0);
    expect(world.subscriptionWrites).toBe(0);
    expect(world.tierWrites).toEqual([]);

    // Stripe reports the subscription once the schedule is attached. The plan stays.
    const attached = await deliverSubscriptionUpdated('evt_schedule_attached');
    expect(attached.body).toEqual({ status: 'processed' });
    expect(localRow().tier).toBe('pro');
    expect(world.tierWrites).toEqual(['pro']);
  });

  it('the plan changes when the new phase starts and its event is handled', async () => {
    await switchTo('price_byok_m');
    await deliverSubscriptionUpdated('evt_schedule_attached');
    expect(localRow().tier).toBe('pro');

    billingPeriodEnds();
    expect(stripeSub().items.data[0]?.price.id).toBe('price_byok_m');
    // Still nothing of ours has changed: only the event does that.
    expect(localRow().tier).toBe('pro');

    const delivered = await deliverSubscriptionUpdated('evt_phase_started');
    expect(delivered.status).toBe(200);
    expect(delivered.body).toEqual({ status: 'processed' });

    expect(localRow().tier).toBe('byok');
    expect(localRow().stripe_subscription_id).toBe('sub_mine');
    expect(world.tierWrites).toEqual(['pro', 'byok']);
    expect(world.billingEvents.at(-1)).toBe('Subscription renewed · byok');
  });

  it('writes the plan once when Stripe delivers the phase event twice', async () => {
    await switchTo('price_byok_m');
    billingPeriodEnds();

    const first = await deliverSubscriptionUpdated('evt_phase_started');
    const second = await deliverSubscriptionUpdated('evt_phase_started');

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
  ])('a change to %s leaves the account on the %s plan once the phase starts', async (priceId, tier) => {
    await switchTo(priceId);
    billingPeriodEnds();
    await deliverSubscriptionUpdated(`evt_${priceId}`);
    expect(localRow().tier).toBe(tier);
    expect(world.tierWrites).toEqual([tier]);
  });

  it('the new phase renames the plan kept on the subscription', async () => {
    await switchTo('price_byok_m');
    billingPeriodEnds();
    expect(stripeSub().metadata).toEqual({ user_id: 'user_test', tier: 'byok' });
  });

  it('the plan follows the price even if the plan name on the subscription were stale', async () => {
    await switchTo('price_byok_m');
    billingPeriodEnds();
    stripeSub().metadata.tier = 'pro';
    await deliverSubscriptionUpdated('evt_phase_stale');
    expect(localRow().tier).toBe('byok');
  });

  it('a change that was taken back never happens', async () => {
    await switchTo('price_byok_m');
    const kept = await request(testApp).delete('/api/billing/subscription/pending-change');
    expect(kept.status).toBe(200);
    expect(schedule()?.status).toBe('released');

    billingPeriodEnds();
    await deliverSubscriptionUpdated('evt_renewal');
    expect(stripeSub().items.data[0]?.price.id).toBe('price_pro_m');
    expect(localRow().tier).toBe('pro');
    expect(world.tierWrites).toEqual(['pro']);
  });

  it('a second change is refused while the first is pending, and accepted after it has been taken back', async () => {
    await switchTo('price_byok_m');
    const second = await switchTo('price_pro_y');
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PLAN_SWITCH_CHANGE_ALREADY_PENDING');

    await request(testApp).delete('/api/billing/subscription/pending-change');
    const third = await switchTo('price_pro_y');
    expect(third.status).toBe(200);
  });
});
