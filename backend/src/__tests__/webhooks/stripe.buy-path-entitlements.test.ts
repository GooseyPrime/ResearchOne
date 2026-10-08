/**
 * What the Stripe webhook grants for each product reachable from the pricing
 * page, and that a replayed event grants it once.
 *
 *  - BYOK plan ($29/mo subscription)             → tier `byok`
 *  - Living Report tokens (1 / 5 / 10 pack)      → that many monitor tokens
 *  - Reverse-Citation Watch ($15/mo per report)  → a monitor on that report,
 *                                                  and the user's plan untouched
 *
 * The webhook is driven through its real router and real dispatch, with an
 * in-memory stand-in for the `stripe_webhook_events` table so idempotency is
 * exercised rather than assumed.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
  const events = new Map<string, { processed: boolean }>();
  return {
    events,
    constructEvent: vi.fn(),
    subscriptionsRetrieve: vi.fn(),
    setUserTier: vi.fn(),
    registerMonitor: vi.fn(),
    creditMonitorTokens: vi.fn(),
    syncSubscription: vi.fn(),
    recordBillingEvent: vi.fn(),
    creditWalletFromCheckoutSession: vi.fn(),
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
        return row ? [{ processed_at: row.processed ? '2026-10-08T00:00:00Z' : null }] : [];
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
  queryOne: vi.fn().mockResolvedValue(null),
  withTransaction: vi.fn(),
  getPool: vi.fn(),
}));
vi.mock('../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock('stripe', () => ({
  default: class MockStripe {
    webhooks = { constructEvent: h.constructEvent };
    subscriptions = { retrieve: h.subscriptionsRetrieve };
  },
}));
vi.mock('../../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../services/tier/tierService', () => ({ setUserTier: h.setUserTier }));
vi.mock('../../services/billing/billingEventsService', () => ({
  recordBillingEvent: h.recordBillingEvent,
}));
vi.mock('../../services/billing/checkoutWalletTopup', () => ({
  creditWalletFromCheckoutSession: h.creditWalletFromCheckoutSession,
}));
vi.mock('../../services/notifications/userNotifications', () => ({
  createUserNotification: vi.fn(),
  resolveUserIdFromStripeSubscription: vi.fn(),
}));
vi.mock('../../services/billing/monitorTokenService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/billing/monitorTokenService')>()),
  creditMonitorTokens: h.creditMonitorTokens,
}));
vi.mock('../../services/billing/subscriptionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/billing/subscriptionService')>()),
  syncSubscription: h.syncSubscription,
  markSubscriptionCanceled: vi.fn(),
}));
// The price → product mapping stays real; only the calls that reach Parallel
// or the database are replaced.
vi.mock('../../services/monitoring/parallelMonitorService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../services/monitoring/parallelMonitorService')>()),
  registerMonitor: h.registerMonitor,
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
}));

import { config } from '../../config';

type Layer = { route?: { stack: Array<{ handle: RequestHandler }> } };

async function deliver(event: { id: string; type: string; data: { object: unknown } }) {
  h.constructEvent.mockReturnValueOnce(event);
  const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: Layer[] };
  const handle = router.stack.find((l) => l.route)?.route?.stack[0].handle;
  const req = { headers: { 'stripe-signature': 'sig' }, body: Buffer.from('{}') } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res);
  await handle!(req, res, vi.fn() as NextFunction);
  return {
    status: vi.mocked(res.status).mock.calls[0]?.[0],
    body: vi.mocked(res.json).mock.calls[0]?.[0] as { status?: string },
  };
}

function subscription(overrides: {
  id: string;
  priceId: string;
  status?: string;
  metadata: Record<string, string>;
}) {
  return {
    id: overrides.id,
    customer: 'cus_1',
    status: overrides.status ?? 'active',
    current_period_end: 1_800_000_000,
    cancel_at_period_end: false,
    metadata: overrides.metadata,
    items: { data: [{ id: 'si_1', price: { id: overrides.priceId, lookup_key: null } }] },
  };
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
    byokMonthly: 'price_byok_m',
    byokAnnual: 'price_byok_y',
    reverseCitationWatchMonthly: 'price_rcw_m',
    monitorTokenPack1: 'price_tok_1',
    monitorTokenPack5: 'price_tok_5',
    monitorTokenPack10: 'price_tok_10',
  });
  config.stripe.secretKey = 'sk_test_x';
  config.stripe.webhookSecret = 'whsec_x';
  h.creditMonitorTokens.mockResolvedValue({ applied: true, tokenBalance: 5 });
  h.registerMonitor.mockResolvedValue({ monitorId: 'm1', parallelMonitorId: 'p1', status: 'active' });
  return () => {
    Object.assign(priceIds, originalPrices);
    Object.assign(config.stripe, originalStripe);
  };
});

describe('BYOK plan', () => {
  const byokSub = (priceId: string) =>
    subscription({ id: 'sub_byok', priceId, metadata: { user_id: 'user_1', tier: 'byok', price_id: priceId } });

  it.each(['price_byok_m', 'price_byok_y'])('checkout for %s grants the byok tier', async (priceId) => {
    h.subscriptionsRetrieve.mockResolvedValue(byokSub(priceId));
    const out = await deliver({
      id: 'evt_byok_checkout',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_byok', mode: 'subscription', subscription: 'sub_byok', client_reference_id: 'user_1' } },
    });

    expect(out.body.status).toBe('processed');
    expect(h.setUserTier).toHaveBeenCalledTimes(1);
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'byok');
    expect(h.syncSubscription).toHaveBeenCalledTimes(1);
    expect(h.registerMonitor).not.toHaveBeenCalled();
    expect(h.creditMonitorTokens).not.toHaveBeenCalled();
  });

  it('grants byok from the price alone when Stripe drops the tier metadata', async () => {
    const out = await deliver({
      id: 'evt_byok_created',
      type: 'customer.subscription.created',
      data: { object: subscription({ id: 'sub_byok', priceId: 'price_byok_m', metadata: { user_id: 'user_1' } }) },
    });
    expect(out.body.status).toBe('processed');
    expect(h.setUserTier).toHaveBeenCalledWith('user_1', 'byok');
  });

  it('does not grant the tier while the subscription is unpaid', async () => {
    await deliver({
      id: 'evt_byok_incomplete',
      type: 'customer.subscription.created',
      data: {
        object: subscription({
          id: 'sub_byok',
          priceId: 'price_byok_m',
          status: 'incomplete',
          metadata: { user_id: 'user_1', tier: 'byok' },
        }),
      },
    });
    expect(h.setUserTier).not.toHaveBeenCalled();
  });

  it('a replayed event grants the tier once', async () => {
    h.subscriptionsRetrieve.mockResolvedValue(byokSub('price_byok_m'));
    const event = {
      id: 'evt_byok_replay',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_byok', mode: 'subscription', subscription: 'sub_byok', client_reference_id: 'user_1' } },
    };
    const first = await deliver(event);
    const second = await deliver(event);

    expect(first.body.status).toBe('processed');
    expect(second.status).toBe(200);
    expect(second.body.status).toBe('already_processed');
    expect(h.setUserTier).toHaveBeenCalledTimes(1);
    expect(h.recordBillingEvent).toHaveBeenCalledTimes(1);
  });
});

describe('Living Report token packs', () => {
  const tokenSession = (pack: string, price: string, count: string, paymentStatus = 'paid') => ({
    id: `cs_${pack}`,
    mode: 'payment',
    status: 'complete',
    payment_status: paymentStatus,
    client_reference_id: 'user_1',
    metadata: {
      user_id: 'user_1',
      price_id: price,
      purchase_type: 'monitor_tokens',
      package_id: pack,
      token_amount: count,
      checkout_kind: 'monitor_tokens',
    },
  });

  it.each([
    ['pack_1', 'price_tok_1', 1],
    ['pack_5', 'price_tok_5', 5],
    ['pack_10', 'price_tok_10', 10],
  ])('%s credits its tokens', async (pack, price, count) => {
    const out = await deliver({
      id: `evt_${pack}`,
      type: 'checkout.session.completed',
      data: { object: tokenSession(pack, price, String(count)) },
    });

    expect(out.body.status).toBe('processed');
    expect(h.creditMonitorTokens).toHaveBeenCalledTimes(1);
    expect(h.creditMonitorTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_1',
        tokenCount: count,
        idempotencyKey: `stripe_monitor_tokens_cs_${pack}`,
        stripeCheckoutSessionId: `cs_${pack}`,
      }),
    );
    // A token purchase is not a wallet top-up and not a plan change.
    expect(h.creditWalletFromCheckoutSession).not.toHaveBeenCalled();
    expect(h.setUserTier).not.toHaveBeenCalled();
  });

  it('credits the count of the pack that was paid for, not the count in the metadata', async () => {
    await deliver({
      id: 'evt_tampered',
      type: 'checkout.session.completed',
      data: { object: tokenSession('pack_1', 'price_tok_1', '10') },
    });
    expect(h.creditMonitorTokens).toHaveBeenCalledWith(expect.objectContaining({ tokenCount: 1 }));
  });

  it('credits nothing while a delayed payment is still unpaid', async () => {
    const out = await deliver({
      id: 'evt_tok_unpaid',
      type: 'checkout.session.completed',
      data: { object: tokenSession('pack_5', 'price_tok_5', '5', 'unpaid') },
    });
    expect(out.body.status).toBe('processed');
    expect(h.creditMonitorTokens).not.toHaveBeenCalled();
    expect(h.creditWalletFromCheckoutSession).not.toHaveBeenCalled();
  });

  it('credits once when the delayed payment later succeeds', async () => {
    await deliver({
      id: 'evt_tok_pending',
      type: 'checkout.session.completed',
      data: { object: tokenSession('pack_5', 'price_tok_5', '5', 'unpaid') },
    });
    const out = await deliver({
      id: 'evt_tok_settled',
      type: 'checkout.session.async_payment_succeeded',
      data: { object: tokenSession('pack_5', 'price_tok_5', '5', 'paid') },
    });
    expect(out.body.status).toBe('processed');
    expect(h.creditMonitorTokens).toHaveBeenCalledTimes(1);
    expect(h.creditMonitorTokens).toHaveBeenCalledWith(
      expect.objectContaining({ tokenCount: 5, idempotencyKey: 'stripe_monitor_tokens_cs_pack_5' }),
    );
  });

  it('credits a fully discounted pack (nothing left to pay)', async () => {
    await deliver({
      id: 'evt_tok_free',
      type: 'checkout.session.completed',
      data: { object: tokenSession('pack_1', 'price_tok_1', '1', 'no_payment_required') },
    });
    expect(h.creditMonitorTokens).toHaveBeenCalledTimes(1);
  });

  it('a replayed event credits once', async () => {
    const event = {
      id: 'evt_tok_replay',
      type: 'checkout.session.completed',
      data: { object: tokenSession('pack_5', 'price_tok_5', '5') },
    };
    await deliver(event);
    const second = await deliver(event);

    expect(second.body.status).toBe('already_processed');
    expect(h.creditMonitorTokens).toHaveBeenCalledTimes(1);
  });

  it('a second event for the same checkout reuses the ledger key, so the ledger refuses the duplicate', async () => {
    const session = tokenSession('pack_5', 'price_tok_5', '5');
    await deliver({ id: 'evt_a', type: 'checkout.session.completed', data: { object: session } });
    await deliver({ id: 'evt_b', type: 'checkout.session.completed', data: { object: session } });

    const keys = h.creditMonitorTokens.mock.calls.map((c) => (c[0] as { idempotencyKey: string }).idempotencyKey);
    expect(keys).toEqual(['stripe_monitor_tokens_cs_pack_5', 'stripe_monitor_tokens_cs_pack_5']);
  });
});

describe('Reverse-Citation Watch', () => {
  const rcwSub = (status = 'active') =>
    subscription({
      id: 'sub_rcw',
      priceId: 'price_rcw_m',
      status,
      metadata: { user_id: 'user_1', report_id: 'report_9', monitor_kind: 'reverse_citation_watch' },
    });

  it('checkout starts the monitor on the report and leaves the plan alone', async () => {
    h.subscriptionsRetrieve.mockResolvedValue(rcwSub());
    const out = await deliver({
      id: 'evt_rcw_checkout',
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_rcw', mode: 'subscription', subscription: 'sub_rcw', client_reference_id: 'user_1' } },
    });

    expect(out.body.status).toBe('processed');
    expect(h.registerMonitor).toHaveBeenCalledTimes(1);
    expect(h.registerMonitor).toHaveBeenCalledWith(
      expect.objectContaining({
        reportId: 'report_9',
        userId: 'user_1',
        monitorKind: 'reverse_citation_watch',
        stripeSubscriptionId: 'sub_rcw',
        stripeSubscriptionItemId: 'si_1',
      }),
    );
    expect(h.recordBillingEvent).toHaveBeenCalledWith(
      expect.objectContaining({ eventKind: 'addon_started', addonKind: 'reverse_citation_watch' }),
    );
    // The add-on must never overwrite the subscriber's Pro/BYOK plan.
    expect(h.setUserTier).not.toHaveBeenCalled();
    expect(h.syncSubscription).not.toHaveBeenCalled();
  });

  it('an unpaid add-on starts no monitor and does not touch the plan', async () => {
    await deliver({
      id: 'evt_rcw_unpaid',
      type: 'customer.subscription.updated',
      data: { object: rcwSub('unpaid') },
    });
    expect(h.registerMonitor).not.toHaveBeenCalled();
    expect(h.setUserTier).not.toHaveBeenCalled();
    expect(h.syncSubscription).not.toHaveBeenCalled();
  });

  it('a replayed event starts the monitor once', async () => {
    const event = { id: 'evt_rcw_replay', type: 'customer.subscription.created', data: { object: rcwSub() } };
    await deliver(event);
    const second = await deliver(event);

    expect(second.body.status).toBe('already_processed');
    expect(h.registerMonitor).toHaveBeenCalledTimes(1);
    expect(h.recordBillingEvent).toHaveBeenCalledTimes(1);
  });
});
