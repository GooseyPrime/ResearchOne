/**
 * The Stripe webhook against payloads shaped like API version
 * 2026-01-28.clover, which is what the live endpoint receives.
 *
 * In that shape a subscription has no `current_period_end` of its own (each
 * item carries it) and an invoice names its subscription under
 * `parent.subscription_details`. The handlers used to read the old places,
 * so every delivery failed and Stripe listed it as undelivered.
 *
 * Also covered: another product's sale on the same Stripe account is
 * acknowledged and nothing is stored; a replayed event is handled once; a
 * real failure on one of our own events still answers with an error so
 * Stripe sends it again.
 *
 * Driven through the real router, dispatch and subscription sync, with an
 * in-memory stand-in for the `stripe_webhook_events` table.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const events = new Map<string, { processed: boolean }>();
  return {
    events,
    constructEvent: vi.fn(),
    subscriptionsRetrieve: vi.fn(),
    customersRetrieve: vi.fn(),
    setUserTier: vi.fn(),
    recordBillingEvent: vi.fn(),
    createUserNotification: vi.fn(),
    resolveUserIdFromStripeSubscription: vi.fn(),
    logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
    /** Stand-in for the idempotency table; every other statement returns no rows. */
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      const id = String(params[0] ?? '');
      if (sql.includes('INSERT INTO stripe_webhook_events')) {
        if (events.has(id)) return [];
        events.set(id, { processed: false });
        return [{ stripe_event_id: id }];
      }
      if (sql.includes('SELECT processed_at FROM stripe_webhook_events')) {
        const row = events.get(id);
        return row ? [{ processed_at: row.processed ? '2026-10-10T00:00:00Z' : null }] : [];
      }
      if (sql.includes('SET processed_at = NOW()')) {
        const row = events.get(id);
        if (row) row.processed = true;
      }
      return [];
    }),
  };
});

vi.mock('../../db/pool', () => ({
  query: h.query,
  queryOne: vi.fn(async (sql: string, params?: unknown[]) => (await h.query(sql, params))[0] ?? null),
  withTransaction: vi.fn(),
  getPool: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({ logger: h.logger }));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: h.constructEvent };
    subscriptions = { retrieve: h.subscriptionsRetrieve };
    customers = { retrieve: h.customersRetrieve };
  },
}));
vi.mock('../../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tier/tierService', () => ({ setUserTier: h.setUserTier }));
vi.mock('../../services/billing/billingEventsService', () => ({
  recordBillingEvent: h.recordBillingEvent,
}));
vi.mock('../../services/notifications/userNotifications', () => ({
  createUserNotification: h.createUserNotification,
  resolveUserIdFromStripeSubscription: h.resolveUserIdFromStripeSubscription,
}));
vi.mock('../../services/monitoring/parallelMonitorService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/monitoring/parallelMonitorService')>()),
  registerMonitor: vi.fn(),
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
}));

import { config } from '../../config';

type Layer = { route?: { stack: Array<{ handle: RequestHandler }> } };

async function deliver(event: { id: string; type: string; data: { object: unknown } }) {
  h.constructEvent.mockReturnValueOnce({ api_version: '2026-01-28.clover', ...event });
  const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: Layer[] };
  const handle = router.stack.find((l) => l.route)?.route?.stack[0].handle;
  const req = { headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}') } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  const next = vi.fn();
  await handle!(req, res, next as NextFunction);
  expect(next).not.toHaveBeenCalled();
  return {
    status: vi.mocked(res.status).mock.calls[0]?.[0] as number,
    body: vi.mocked(res.json).mock.calls[0]?.[0] as { status?: string; error?: string },
  };
}

const PERIOD_START = 1_759_276_800; // 2025-10-01T00:00:00Z
const PERIOD_END = 1_761_955_200; // 2025-11-01T00:00:00Z
const PERIOD_END_ISO = new Date(PERIOD_END * 1000).toISOString();

/** A subscription as 2026-01-28.clover sends it: the period lives on the item. */
function cloverSubscription(overrides: {
  id?: string;
  priceId?: string;
  status?: string;
  cancelAtPeriodEnd?: boolean;
  metadata?: Record<string, string>;
  itemPeriod?: { start?: number; end?: number } | null;
} = {}) {
  const period = overrides.itemPeriod === null ? {} : {
    current_period_start: overrides.itemPeriod?.start ?? PERIOD_START,
    current_period_end: overrides.itemPeriod?.end ?? PERIOD_END,
  };
  return {
    id: overrides.id ?? 'sub_r1',
    object: 'subscription',
    billing_cycle_anchor: PERIOD_START,
    billing_mode: { type: 'classic' },
    cancel_at: null,
    cancel_at_period_end: overrides.cancelAtPeriodEnd ?? false,
    collection_method: 'charge_automatically',
    currency: 'usd',
    customer: 'cus_r1',
    latest_invoice: 'in_r1',
    livemode: true,
    metadata: overrides.metadata ?? { user_id: 'user_1', tier: 'pro', price_id: 'price_pro_m' },
    start_date: PERIOD_START,
    status: overrides.status ?? 'active',
    items: {
      object: 'list',
      data: [
        {
          id: 'si_r1',
          object: 'subscription_item',
          ...period,
          metadata: {},
          price: {
            id: overrides.priceId ?? 'price_pro_m',
            object: 'price',
            lookup_key: null,
            product: 'prod_r1',
            recurring: { interval: 'month', interval_count: 1 },
            unit_amount: 2900,
          },
          quantity: 1,
          subscription: overrides.id ?? 'sub_r1',
        },
      ],
      has_more: false,
    },
  };
}

/** An invoice as 2026-01-28.clover sends it: no top-level `subscription`. */
function cloverInvoice(overrides: {
  id?: string;
  subscriptionId?: string;
  priceId?: string;
  metadata?: Record<string, string>;
} = {}) {
  const subscriptionId = overrides.subscriptionId ?? 'sub_r1';
  return {
    id: overrides.id ?? 'in_r1',
    object: 'invoice',
    amount_due: 2900,
    amount_paid: 2900,
    billing_reason: 'subscription_cycle',
    created: PERIOD_END,
    currency: 'usd',
    customer: 'cus_r1',
    livemode: true,
    metadata: {},
    parent: {
      type: 'subscription_details',
      quote_details: null,
      subscription_details: {
        subscription: subscriptionId,
        metadata: overrides.metadata ?? { user_id: 'user_1', tier: 'pro', price_id: 'price_pro_m' },
      },
    },
    status: 'paid',
    lines: {
      object: 'list',
      data: [
        {
          id: 'il_r1',
          object: 'line_item',
          amount: 2900,
          metadata: overrides.metadata ?? { user_id: 'user_1', tier: 'pro', price_id: 'price_pro_m' },
          parent: {
            type: 'subscription_item_details',
            subscription_item_details: { subscription: subscriptionId, subscription_item: 'si_r1' },
          },
          period: { start: PERIOD_START, end: PERIOD_END },
          pricing: {
            type: 'price_details',
            price_details: { price: overrides.priceId ?? 'price_pro_m', product: 'prod_r1' },
          },
        },
      ],
      has_more: false,
    },
  };
}

function cloverCheckoutSession(overrides: {
  id?: string;
  mode?: 'subscription' | 'payment';
  subscriptionId?: string | null;
  metadata?: Record<string, string>;
} = {}) {
  const mode = overrides.mode ?? 'subscription';
  return {
    id: overrides.id ?? 'cs_r1',
    object: 'checkout.session',
    client_reference_id: 'user_1',
    customer: 'cus_r1',
    livemode: true,
    metadata:
      overrides.metadata ?? { user_id: 'user_1', tier: 'pro', price_id: 'price_pro_m', checkout_kind: 'subscription' },
    mode,
    payment_status: 'paid',
    status: 'complete',
    subscription: mode === 'subscription' ? (overrides.subscriptionId ?? 'sub_r1') : null,
  };
}

function subscriptionWrites() {
  return h.query.mock.calls.filter(
    (call) => typeof call[0] === 'string' && call[0].includes('INSERT INTO user_subscriptions')
  );
}

/** [userId, tier, status, customer, subscription, cancelAtPeriodEnd, currentPeriodEnd] */
function lastSubscriptionWrite(): unknown[] {
  const writes = subscriptionWrites();
  return (writes[writes.length - 1]?.[1] ?? []) as unknown[];
}

const priceIds = config.stripe.priceIds as Record<string, string>;
const originalPrices = { ...priceIds };
const originalStripe = { secretKey: config.stripe.secretKey, webhookSecret: config.stripe.webhookSecret };

beforeEach(() => {
  vi.clearAllMocks();
  h.events.clear();
  for (const key of Object.keys(priceIds)) priceIds[key] = '';
  Object.assign(priceIds, {
    proMonthly: 'price_pro_m',
    proAnnual: 'price_pro_y',
    byokMonthly: 'price_byok_m',
    reverseCitationWatchMonthly: 'price_rcw_m',
    wallet20: 'price_wallet_20',
    monitorTokenPack5: 'price_tok_5',
  });
  config.stripe.secretKey = 'sk_test_x';
  config.stripe.webhookSecret = 'whsec_x';
  h.subscriptionsRetrieve.mockResolvedValue(cloverSubscription());
  h.customersRetrieve.mockResolvedValue({ id: 'cus_r1', metadata: {} });
  h.resolveUserIdFromStripeSubscription.mockResolvedValue('user_1');
  return () => {
    Object.assign(priceIds, originalPrices);
    Object.assign(config.stripe, originalStripe);
  };
});

describe('2026-01-28.clover payloads for a ResearchOne plan', () => {
  it('checkout.session.completed upgrades the buyer and stores the period end from the item', async () => {
    const out = await deliver({
      id: 'evt_checkout',
      type: 'checkout.session.completed',
      data: { object: cloverCheckoutSession() },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    expect(h.subscriptionsRetrieve).toHaveBeenCalledWith('sub_r1');
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'pro');
    expect(lastSubscriptionWrite()).toEqual(['user_1', 'pro', 'active', 'cus_r1', 'sub_r1', false, PERIOD_END_ISO]);
  });

  it('customer.subscription.created reads the period end from items.data[0]', async () => {
    const subscription = cloverSubscription();
    expect('current_period_end' in subscription).toBe(false);

    const out = await deliver({
      id: 'evt_created',
      type: 'customer.subscription.created',
      data: { object: subscription },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    expect(lastSubscriptionWrite()[6]).toBe(PERIOD_END_ISO);
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'pro');
    expect(h.logger.warn).not.toHaveBeenCalledWith('stripe_subscription_period_end_missing', expect.anything());
  });

  it('customer.subscription.updated carries the new period end and the cancel flag', async () => {
    const nextEnd = PERIOD_END + 30 * 86400;
    const out = await deliver({
      id: 'evt_updated',
      type: 'customer.subscription.updated',
      data: { object: cloverSubscription({ cancelAtPeriodEnd: true, itemPeriod: { start: PERIOD_END, end: nextEnd } }) },
    });

    expect(out.status).toBe(200);
    const write = lastSubscriptionWrite();
    expect(write[5]).toBe(true);
    expect(write[6]).toBe(new Date(nextEnd * 1000).toISOString());
  });

  it('customer.subscription.updated to past_due stores the status and grants nothing', async () => {
    const out = await deliver({
      id: 'evt_past_due',
      type: 'customer.subscription.updated',
      data: { object: cloverSubscription({ status: 'unpaid' }) },
    });

    expect(out.status).toBe(200);
    expect(lastSubscriptionWrite()[2]).toBe('unpaid');
    expect(h.setUserTier).not.toHaveBeenCalled();
  });

  it('customer.subscription.deleted ends the plan', async () => {
    const out = await deliver({
      id: 'evt_deleted',
      type: 'customer.subscription.deleted',
      data: { object: cloverSubscription({ status: 'canceled' }) },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    const cancel = h.query.mock.calls.find(
      (call) => typeof call[0] === 'string' && call[0].includes("SET status = 'canceled'")
    );
    expect(cancel?.[1]).toEqual(['sub_r1']);
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'free_demo');
  });

  it('invoice.payment_succeeded finds the subscription under parent.subscription_details', async () => {
    const invoice = cloverInvoice();
    expect('subscription' in invoice).toBe(false);

    const out = await deliver({
      id: 'evt_invoice_paid',
      type: 'invoice.payment_succeeded',
      data: { object: invoice },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    expect(h.subscriptionsRetrieve).toHaveBeenCalledWith('sub_r1');
    expect(lastSubscriptionWrite()[6]).toBe(PERIOD_END_ISO);
    expect(h.recordBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventKind: 'invoice_paid',
        stripeInvoiceId: 'in_r1',
        stripeSubscriptionId: 'sub_r1',
        amountCents: 2900,
      })
    );
  });

  it('invoice.payment_failed tells the subscriber and records the failed renewal', async () => {
    const out = await deliver({
      id: 'evt_invoice_failed',
      type: 'invoice.payment_failed',
      data: { object: cloverInvoice() },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    expect(h.resolveUserIdFromStripeSubscription).toHaveBeenCalledWith('sub_r1');
    expect(h.createUserNotification).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'user_1', kind: 'payment_failed' })
    );
    expect(h.recordBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: 'invoice_payment_failed', stripeSubscriptionId: 'sub_r1' })
    );
  });
});

describe('older payload shape still works', () => {
  it('falls back to the top-level current_period_end when the item has none', async () => {
    const subscription = { ...cloverSubscription({ itemPeriod: null }), current_period_end: PERIOD_END };
    const out = await deliver({
      id: 'evt_old_sub',
      type: 'customer.subscription.updated',
      data: { object: subscription },
    });

    expect(out.status).toBe(200);
    expect(lastSubscriptionWrite()[6]).toBe(PERIOD_END_ISO);
  });

  it('falls back to invoice.subscription when there is no parent', async () => {
    const { parent: _parent, ...rest } = cloverInvoice();
    const out = await deliver({
      id: 'evt_old_invoice',
      type: 'invoice.payment_succeeded',
      data: { object: { ...rest, subscription: 'sub_r1' } },
    });

    expect(out.status).toBe(200);
    expect(h.subscriptionsRetrieve).toHaveBeenCalledWith('sub_r1');
    expect(h.recordBillingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKind: 'invoice_paid' }));
  });
});

describe('a subscription with no period end anywhere', () => {
  it('is still applied, with a warning, and never throws', async () => {
    const out = await deliver({
      id: 'evt_no_period',
      type: 'customer.subscription.updated',
      data: { object: cloverSubscription({ itemPeriod: null }) },
    });

    expect(out.status).toBe(200);
    expect(out.body.status).toBe('processed');
    expect(h.logger.warn).toHaveBeenCalledWith(
      'stripe_subscription_period_end_missing',
      expect.objectContaining({ eventId: 'evt_no_period', subscriptionId: 'sub_r1', source: 'webhook' })
    );
    // Null leaves the stored period end as it was (COALESCE in the upsert).
    const writes = subscriptionWrites();
    expect(writes).toHaveLength(1);
    expect((writes[0][1] as unknown[])[6]).toBeNull();
    expect(String(writes[0][0])).toContain(
      'COALESCE(EXCLUDED.current_period_end, user_subscriptions.current_period_end)'
    );
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'pro');
  });
});

describe("another product's sale on the same Stripe account", () => {
  const foreignMetadata = { user_id: 'user_elsewhere', tier: 'pro', price_id: 'price_other_product' };

  it.each([
    [
      'customer.subscription.created',
      cloverSubscription({ id: 'sub_other', priceId: 'price_other_product', metadata: foreignMetadata }),
    ],
    [
      'customer.subscription.updated',
      cloverSubscription({ id: 'sub_other', priceId: 'price_other_product', metadata: foreignMetadata }),
    ],
    [
      'customer.subscription.deleted',
      cloverSubscription({ id: 'sub_other', priceId: 'price_other_product', status: 'canceled', metadata: foreignMetadata }),
    ],
    [
      'invoice.payment_succeeded',
      cloverInvoice({ id: 'in_other', subscriptionId: 'sub_other', priceId: 'price_other_product', metadata: foreignMetadata }),
    ],
    [
      'invoice.payment_failed',
      cloverInvoice({ id: 'in_other', subscriptionId: 'sub_other', priceId: 'price_other_product', metadata: foreignMetadata }),
    ],
    [
      'checkout.session.completed',
      cloverCheckoutSession({ id: 'cs_other', mode: 'payment', metadata: foreignMetadata }),
    ],
  ])('%s answers 200 and writes nothing', async (type, object) => {
    const out = await deliver({ id: `evt_other_${type}`, type, data: { object } });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: 'ignored' });
    expect(h.query).not.toHaveBeenCalled();
    expect(h.setUserTier).not.toHaveBeenCalled();
    expect(h.recordBillingEvent).not.toHaveBeenCalled();
    expect(h.createUserNotification).not.toHaveBeenCalled();
    expect(h.logger.debug).toHaveBeenCalledWith(
      'stripe_webhook_foreign_event_ignored',
      expect.objectContaining({ eventType: type })
    );
  });

  it('a subscription checkout is checked against its subscription before it is set aside', async () => {
    h.subscriptionsRetrieve.mockResolvedValue(
      cloverSubscription({ id: 'sub_other', priceId: 'price_other_product', metadata: foreignMetadata })
    );
    const out = await deliver({
      id: 'evt_other_sub_checkout',
      type: 'checkout.session.completed',
      data: { object: cloverCheckoutSession({ id: 'cs_other', subscriptionId: 'sub_other', metadata: foreignMetadata }) },
    });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: 'ignored' });
    expect(h.query).not.toHaveBeenCalled();
  });

  it('still answers 200 when Stripe cannot be asked about that subscription', async () => {
    h.subscriptionsRetrieve.mockRejectedValue(new Error('stripe unavailable'));
    const out = await deliver({
      id: 'evt_other_lookup_down',
      type: 'checkout.session.completed',
      data: { object: cloverCheckoutSession({ id: 'cs_other', subscriptionId: 'sub_other', metadata: foreignMetadata }) },
    });

    expect(out.status).toBe(200);
    expect(out.body).toEqual({ status: 'ignored' });
    expect(h.query).not.toHaveBeenCalled();
  });

  it('a ResearchOne add-on is recognised by its metadata even on a price no longer configured', async () => {
    const out = await deliver({
      id: 'evt_addon_old_price',
      type: 'customer.subscription.deleted',
      data: {
        object: cloverSubscription({
          id: 'sub_rcw',
          priceId: 'price_rcw_retired',
          status: 'canceled',
          metadata: { user_id: 'user_1', report_id: 'report_9', monitor_kind: 'reverse_citation_watch' },
        }),
      },
    });

    expect(out.body.status).toBe('processed');
    expect(h.recordBillingEvent).toHaveBeenCalledWith(expect.objectContaining({ eventKind: 'addon_canceled' }));
  });
});

describe('replays and real failures', () => {
  it('a replayed event is skipped', async () => {
    const event = {
      id: 'evt_replay',
      type: 'customer.subscription.updated',
      data: { object: cloverSubscription() },
    };
    const first = await deliver(event);
    const second = await deliver(event);

    expect(first.body.status).toBe('processed');
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already_processed');
    expect(subscriptionWrites()).toHaveLength(1);
    expect(h.setUserTier).toHaveBeenCalledTimes(1);
  });

  it('a ResearchOne event that cannot be applied answers 500, and succeeds when Stripe sends it again', async () => {
    const event = {
      id: 'evt_retry',
      type: 'customer.subscription.updated',
      // Our price, but nothing says whose subscription it is.
      data: { object: cloverSubscription({ metadata: {} }) },
    };
    const first = await deliver(event);
    expect(first.status).toBe(500);
    expect(subscriptionWrites()).toHaveLength(0);

    h.customersRetrieve.mockResolvedValue({ id: 'cus_r1', metadata: { user_id: 'user_1' } });
    const second = await deliver(event);
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('processed');
    expect(subscriptionWrites()).toHaveLength(1);
  });
});
