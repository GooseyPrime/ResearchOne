/**
 * After a plan switch Stripe sends `customer.subscription.updated` carrying the
 * new price. The account's plan is set from that event by the webhook's
 * existing sync, which runs for real here (only the database, Stripe and the
 * monitor service are faked).
 *
 * Covered: the new price decides the plan even though the subscription still
 * carries the old plan name; and the same event delivered twice writes once.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  queryOne: vi.fn(),
  constructEvent: vi.fn(),
  setUserTier: vi.fn(),
}));

vi.mock('../../db/pool', () => ({ query: mocks.query, queryOne: mocks.queryOne, withTransaction: vi.fn() }));
vi.mock('../../config', () => ({
  config: {
    stripe: {
      secretKey: 'sk_test_abc',
      webhookSecret: 'whsec_test_secret',
      priceIds: {
        proMonthly: 'price_pro_m',
        proAnnual: 'price_pro_y',
        byokMonthly: 'price_byok_m',
        byokAnnual: 'price_byok_y',
        teamSeatMonthly: 'price_team_m',
      },
    },
  },
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: mocks.constructEvent };
  },
}));
vi.mock('../../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tier/tierService', () => ({ setUserTier: mocks.setUserTier }));
vi.mock('../../services/monitoring/parallelMonitorService', () => ({
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  monitorKindFromStripePriceId: vi.fn().mockReturnValue(null),
  registerMonitor: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
  subscriptionHasLivingReportsPrice: vi.fn().mockReturnValue(false),
}));
vi.mock('../../services/notifications/userNotifications', () => ({
  createUserNotification: vi.fn(),
  resolveUserIdFromStripeSubscription: vi.fn(),
}));

type StripeWebhookRouterLayer = { route?: { stack: Array<{ handle: RequestHandler }> } };

/** A stand-in for the two tables the webhook writes: delivered events and subscriptions. */
function fakeDatabase() {
  const processedEvents = new Set<string>();
  const subscriptionWrites: Array<{ userId: string; tier: string; stripeSubscriptionId: string }> = [];
  const billingEvents: Array<{ stripeEventId: string; description: string }> = [];

  mocks.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes('INSERT INTO stripe_webhook_events')) {
      const id = String(params[0]);
      return processedEvents.has(id) ? [] : [{ stripe_event_id: id }];
    }
    if (sql.includes('SELECT processed_at FROM stripe_webhook_events')) {
      return processedEvents.has(String(params[0])) ? [{ processed_at: '2026-10-08T00:00:00Z' }] : [];
    }
    if (sql.includes('UPDATE stripe_webhook_events SET processed_at')) {
      processedEvents.add(String(params[0]));
      return [];
    }
    if (sql.includes('INSERT INTO user_subscriptions')) {
      subscriptionWrites.push({
        userId: String(params[0]),
        tier: String(params[1]),
        stripeSubscriptionId: String(params[4]),
      });
      return [];
    }
    if (sql.includes('billing_events')) {
      billingEvents.push({
        stripeEventId: String(params[1]),
        description: params.map(String).find((p) => p.startsWith('Subscription')) ?? '',
      });
      return [];
    }
    return [];
  });
  // The row as it stood before the switch: this user was on Pro.
  mocks.queryOne.mockResolvedValue({
    status: 'active',
    current_period_end: '2026-11-01T00:00:00.000Z',
    cancel_at_period_end: false,
    tier: 'pro',
  });

  return { subscriptionWrites, billingEvents };
}

function switchedEvent(priceId: string, eventId = 'evt_switch_1') {
  return {
    id: eventId,
    type: 'customer.subscription.updated',
    data: {
      object: {
        id: 'sub_mine',
        customer: 'cus_mine',
        status: 'active',
        current_period_end: Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000),
        cancel_at_period_end: false,
        // Deliberately the plan the customer left. The price must win.
        metadata: { user_id: 'user_test', tier: 'pro' },
        items: { data: [{ id: 'si_plan', price: { id: priceId, lookup_key: null } }] },
      },
    },
  };
}

async function deliver(event: ReturnType<typeof switchedEvent>): Promise<unknown> {
  mocks.constructEvent.mockReturnValueOnce(event);
  const router = (await import('../../api/webhooks/stripe')).default as unknown as {
    stack: StripeWebhookRouterLayer[];
  };
  const handler = router.stack.find((l) => l.route)?.route?.stack[0].handle;
  if (!handler) throw new Error('webhook handler not found');

  const req = { headers: { 'stripe-signature': 'valid_sig' }, body: Buffer.from('{}') } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  await handler(req, res, vi.fn() as NextFunction);
  return vi.mocked(res.json).mock.calls[0]?.[0];
}

describe('customer.subscription.updated after a plan switch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setUserTier.mockResolvedValue(undefined);
  });

  it('sets the plan from the new price, not from the old plan name on the subscription', async () => {
    const db = fakeDatabase();

    const body = await deliver(switchedEvent('price_byok_m'));

    expect(body).toEqual({ status: 'processed' });
    expect(db.subscriptionWrites).toEqual([
      { userId: 'user_test', tier: 'byok', stripeSubscriptionId: 'sub_mine' },
    ]);
    expect(mocks.setUserTier).toHaveBeenCalledTimes(1);
    expect(mocks.setUserTier).toHaveBeenCalledWith('user_test', 'byok');
    expect(db.billingEvents).toEqual([
      { stripeEventId: 'evt_switch_1', description: 'Subscription updated · byok' },
    ]);
  });

  it.each([
    ['price_pro_m', 'pro'],
    ['price_pro_y', 'pro'],
    ['price_byok_m', 'byok'],
    ['price_byok_y', 'byok'],
  ])('maps %s to the %s plan', async (priceId, tier) => {
    const db = fakeDatabase();
    await deliver(switchedEvent(priceId));
    expect(db.subscriptionWrites.map((w) => w.tier)).toEqual([tier]);
    expect(mocks.setUserTier).toHaveBeenCalledWith('user_test', tier);
  });

  it('writes once when Stripe delivers the same event twice', async () => {
    const db = fakeDatabase();

    const first = await deliver(switchedEvent('price_byok_m'));
    const second = await deliver(switchedEvent('price_byok_m'));

    expect(first).toEqual({ status: 'processed' });
    expect(second).toEqual({ status: 'already_processed' });
    expect(db.subscriptionWrites).toHaveLength(1);
    expect(mocks.setUserTier).toHaveBeenCalledTimes(1);
    expect(db.billingEvents).toHaveLength(1);
  });
});
