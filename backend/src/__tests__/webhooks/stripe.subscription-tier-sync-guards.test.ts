/**
 * Webhook routes subscription events through `syncStripeSubscriptionToUser`.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  constructEvent: vi.fn(),
  syncStripeSubscriptionToUser: vi.fn(),
  resolveUserIdForSubscription: vi.fn(),
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
vi.mock('../../services/billing/syncStripeSubscription', () => ({
  syncStripeSubscriptionToUser: mocks.syncStripeSubscriptionToUser,
  resolveUserIdForSubscription: mocks.resolveUserIdForSubscription,
  StripeSubscriptionUserUnresolvedError: class StripeSubscriptionUserUnresolvedError extends Error {
    constructor(
      public readonly subscriptionId: string,
      public readonly eventId?: string
    ) {
      super(`unresolved subscription ${subscriptionId}`);
      this.name = 'StripeSubscriptionUserUnresolvedError';
    }
  },
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
  mocks.resolveUserIdForSubscription.mockResolvedValueOnce(
    (body.data as { object: { metadata?: { user_id?: string } } }).object.metadata?.user_id ?? null
  );

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

describe('stripe subscription.updated → syncStripeSubscriptionToUser', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.syncStripeSubscriptionToUser.mockResolvedValue(undefined);
  });

  it('invokes canonical sync when user_id resolves from metadata', async () => {
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

    expect(mocks.syncStripeSubscriptionToUser).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user_active',
        source: 'webhook',
      })
    );
  });
});
