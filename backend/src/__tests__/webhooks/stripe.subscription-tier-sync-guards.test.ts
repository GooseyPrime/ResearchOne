/**
 * PR #124 follow-up: `customer.subscription.created/updated` must not downgrade
 * `user_tiers` on non-granting Stripe statuses or on add-on subscriptions.
 *
 * Per Rule 16: assert the absence of `setUserTier` when the bug would fire.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parallelMonitorService from '../../services/monitoring/parallelMonitorService';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  constructEvent: vi.fn(),
  setUserTier: vi.fn(),
  syncSubscription: vi.fn(),
  markSubscriptionCanceled: vi.fn(),
  resolveSubscriptionPlanTier: vi.fn(),
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
  resolveSubscriptionPlanTier: mocks.resolveSubscriptionPlanTier,
}));
vi.mock('../../services/monitoring/parallelMonitorService', () => ({
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  monitorKindFromStripePriceId: vi.fn(),
  registerMonitor: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
  subscriptionHasLivingReportsPrice: vi.fn().mockReturnValue(false),
}));

type StripeWebhookRouterLayer = { route?: { stack: Array<{ handle: RequestHandler }> } };

async function dispatchSubscriptionUpdated(body: Record<string, unknown>) {
  mocks.constructEvent.mockReturnValueOnce(body);
  mocks.query.mockResolvedValue([]);

  const router = (await import('../../api/webhooks/stripe')).default as unknown as {
    stack: StripeWebhookRouterLayer[];
  };
  const layer = router.stack.find((l) => l.route)?.route?.stack[0].handle;
  if (!layer) throw new Error('webhook handler not found');

  const req = {
    headers: { 'stripe-signature': 'valid_sig' },
    body: Buffer.from('{}'),
  } as unknown as Request;
  const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
  vi.mocked(res.status).mockReturnValue(res as Response);

  await layer(req, res, vi.fn() as NextFunction);
}

describe('stripe subscription.updated tier sync guards (PR #124)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveSubscriptionPlanTier.mockReturnValue('free_demo');
    vi.mocked(parallelMonitorService.subscriptionHasLivingReportsPrice).mockReturnValue(false);
  });

  it('does not call setUserTier for unpaid add-on with monitor_kind (non-granting)', async () => {
    vi.mocked(parallelMonitorService.subscriptionHasLivingReportsPrice).mockReturnValue(true);

    await dispatchSubscriptionUpdated({
      id: 'evt_addon_unpaid',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_addon_unpaid',
          customer: 'cus_addon',
          status: 'unpaid',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
          metadata: {
            user_id: 'user_keeps_pro',
            monitor_kind: 'living_report',
            report_id: 'rep1',
          },
          items: { data: [{ id: 'si_1', price: { id: 'price_living_report', lookup_key: null } }] },
        },
      },
    });

    expect(mocks.syncSubscription).toHaveBeenCalled();
    expect(mocks.setUserTier).not.toHaveBeenCalled();
    expect(mocks.resolveSubscriptionPlanTier).not.toHaveBeenCalled();
  });

  it('does not call setUserTier when main plan subscription is unpaid', async () => {
    await dispatchSubscriptionUpdated({
      id: 'evt_plan_unpaid',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_pro_main',
          customer: 'cus_pro',
          status: 'unpaid',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
          metadata: { user_id: 'user_unpaid' },
          items: { data: [{ price: { id: 'price_pro_monthly', lookup_key: 'pro_monthly' } }] },
        },
      },
    });

    expect(mocks.syncSubscription).toHaveBeenCalled();
    expect(mocks.setUserTier).not.toHaveBeenCalled();
  });

  it('calls setUserTier when subscription grants access and tier resolves', async () => {
    mocks.resolveSubscriptionPlanTier.mockReturnValue('pro');

    await dispatchSubscriptionUpdated({
      id: 'evt_plan_active',
      type: 'customer.subscription.updated',
      data: {
        object: {
          id: 'sub_pro_active',
          customer: 'cus_pro',
          status: 'active',
          current_period_end: Math.floor(Date.now() / 1000) + 86400,
          cancel_at_period_end: false,
          metadata: { user_id: 'user_active' },
          items: { data: [{ price: { id: 'price_pro_monthly', lookup_key: 'pro_monthly' } }] },
        },
      },
    });

    expect(mocks.syncSubscription).toHaveBeenCalled();
    expect(mocks.resolveSubscriptionPlanTier).toHaveBeenCalled();
    expect(mocks.setUserTier).toHaveBeenCalledWith('user_active', 'pro');
  });
});
