/**
 * Tests: customer.subscription.deleted properly discriminates between add-on
 * subscriptions (Living Report / Reverse-Citation Watch) and tier subscriptions
 * (Pro / Team / BYOK / Student).
 *
 * Per Rule 16: These tests MUST fail without the discriminator fix.
 *
 * Bugs prevented:
 *  - Add-on cancel must NOT downgrade the user's tier to free_demo.
 *  - Tier cancel must cascade-cancel any of the user's active add-on subs.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  constructEvent: vi.fn(),
  setUserTier: vi.fn(),
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  markSubscriptionCanceled: vi.fn(),
  syncSubscription: vi.fn(),
}));

vi.mock('../../db/pool', () => ({ query: mocks.query, queryOne: vi.fn() }));
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
        livingReportMonthly: 'price_living_report',
        reverseCitationWatchMonthly: 'price_rcw',
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
vi.mock('../../services/tier/tierService', () => ({
  setUserTier: mocks.setUserTier,
}));
vi.mock('../../services/billing/subscriptionService', () => ({
  syncSubscription: mocks.syncSubscription,
  markSubscriptionCanceled: mocks.markSubscriptionCanceled,
  resolveSubscriptionPlanTier: vi.fn(),
}));
vi.mock('../../services/monitoring/parallelMonitorService', () => ({
  cancelMonitorByStripeSubscription: mocks.cancelMonitorByStripeSubscription,
  cancelUserAddonSubscriptions: mocks.cancelUserAddonSubscriptions,
  monitorKindFromStripePriceId: vi.fn(),
  registerMonitor: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
  subscriptionHasLivingReportsPrice: vi.fn().mockReturnValue(false),
}));

type StripeWebhookRouterLayer = { route?: { stack: Array<{ handle: RequestHandler }> } };

async function callHandler(eventBody: Record<string, unknown>) {
  mocks.constructEvent.mockReturnValueOnce(eventBody);
  mocks.query.mockResolvedValue([]);

  const router = (await import('../../api/webhooks/stripe')).default as unknown as { stack: StripeWebhookRouterLayer[] };
  const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
  if (!layer) throw new Error('webhook handler not found');

  const req = {
    headers: { 'stripe-signature': 'valid_sig' },
    body: Buffer.from('{}'),
  } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res as Response);

  await layer(req, res, vi.fn() as NextFunction);
  return { res };
}

describe('customer.subscription.deleted discriminator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('add-on subscription cancel does NOT downgrade tier and does NOT cascade', async () => {
    const userId = 'user_keeps_pro';
    await callHandler({
      id: 'evt_addon_cancel',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_living_report_xyz',
          customer: 'cus_living',
          status: 'canceled',
          current_period_end: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
          metadata: { user_id: userId, monitor_kind: 'living_report', report_id: 'r1' },
          items: { data: [{ price: { id: 'price_living_report', lookup_key: null } }] },
        },
      },
    });

    expect(mocks.cancelMonitorByStripeSubscription).toHaveBeenCalledWith('sub_living_report_xyz');
    // CRITICAL: tier must not be downgraded by an add-on cancel
    expect(mocks.setUserTier).not.toHaveBeenCalled();
    expect(mocks.cancelUserAddonSubscriptions).not.toHaveBeenCalled();
  });

  it('tier subscription cancel downgrades tier AND cascades add-on cancel', async () => {
    const userId = 'user_lost_pro';
    await callHandler({
      id: 'evt_tier_cancel',
      type: 'customer.subscription.deleted',
      data: {
        object: {
          id: 'sub_pro_main',
          customer: 'cus_pro_main',
          status: 'canceled',
          current_period_end: Math.floor(Date.now() / 1000),
          cancel_at_period_end: false,
          metadata: { user_id: userId },
          items: { data: [{ price: { id: 'price_pro_monthly', lookup_key: 'pro_monthly' } }] },
        },
      },
    });

    expect(mocks.setUserTier).toHaveBeenCalledWith(userId, 'free_demo');
    expect(mocks.cancelUserAddonSubscriptions).toHaveBeenCalledWith(userId);
  });
});
