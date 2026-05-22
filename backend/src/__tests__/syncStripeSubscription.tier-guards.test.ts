/**
 * PR #124 / WO-Y: canonical `syncStripeSubscriptionToUser` must not downgrade
 * `user_tiers` on non-granting Stripe statuses or on add-on subscriptions.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import * as parallelMonitorService from '../services/monitoring/parallelMonitorService';

const mocks = vi.hoisted(() => ({
  queryOne: vi.fn(),
  setUserTier: vi.fn(),
  syncSubscription: vi.fn(),
  resolveSubscriptionPlanTier: vi.fn(),
  ensureUserAndTierRow: vi.fn(),
  recordBillingEvent: vi.fn(),
}));

vi.mock('../db/pool', () => ({ query: vi.fn(), queryOne: mocks.queryOne }));
vi.mock('../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('../services/tier/tierService', () => ({
  setUserTier: mocks.setUserTier,
}));
vi.mock('../services/billing/subscriptionService', () => ({
  syncSubscription: mocks.syncSubscription,
  resolveSubscriptionPlanTier: mocks.resolveSubscriptionPlanTier,
}));
vi.mock('../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: mocks.ensureUserAndTierRow,
}));
vi.mock('../services/billing/billingEventsService', () => ({
  recordBillingEvent: mocks.recordBillingEvent,
}));
vi.mock('../services/monitoring/parallelMonitorService', () => ({
  cancelMonitorByStripeSubscription: vi.fn(),
  cancelUserAddonSubscriptions: vi.fn(),
  monitorKindFromStripePriceId: vi.fn(),
  registerMonitor: vi.fn(),
  recordSubscriptionPastDueForMonitor: vi.fn(),
  subscriptionHasLivingReportsPrice: vi.fn().mockReturnValue(false),
}));

import { syncStripeSubscriptionToUser } from '../services/billing/syncStripeSubscription';

describe('syncStripeSubscriptionToUser tier sync guards (PR #124)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureUserAndTierRow.mockResolvedValue(undefined);
    mocks.syncSubscription.mockResolvedValue(undefined);
    mocks.recordBillingEvent.mockResolvedValue(undefined);
    mocks.queryOne.mockResolvedValue(null);
    mocks.resolveSubscriptionPlanTier.mockReturnValue('free_demo');
    vi.mocked(parallelMonitorService.subscriptionHasLivingReportsPrice).mockReturnValue(false);
  });

  it('does not call setUserTier for unpaid add-on with monitor_kind (non-granting)', async () => {
    vi.mocked(parallelMonitorService.subscriptionHasLivingReportsPrice).mockReturnValue(true);

    await syncStripeSubscriptionToUser({
      userId: 'user_keeps_pro',
      source: 'webhook',
      subscription: {
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
    });

    expect(mocks.syncSubscription).not.toHaveBeenCalled();
    expect(mocks.setUserTier).not.toHaveBeenCalled();
  });

  it('does not call setUserTier when main plan subscription is unpaid', async () => {
    await syncStripeSubscriptionToUser({
      userId: 'user_unpaid',
      source: 'webhook',
      subscription: {
        id: 'sub_pro_main',
        customer: 'cus_pro',
        status: 'unpaid',
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        cancel_at_period_end: false,
        metadata: { user_id: 'user_unpaid' },
        items: { data: [{ price: { id: 'price_pro_monthly', lookup_key: 'pro_monthly' } }] },
      },
    });

    expect(mocks.syncSubscription).toHaveBeenCalled();
    expect(mocks.setUserTier).not.toHaveBeenCalled();
  });

  it('calls setUserTier when subscription grants access and tier resolves', async () => {
    mocks.resolveSubscriptionPlanTier.mockReturnValue('pro');

    await syncStripeSubscriptionToUser({
      userId: 'user_active',
      source: 'webhook',
      subscription: {
        id: 'sub_pro_active',
        customer: 'cus_pro',
        status: 'active',
        current_period_end: Math.floor(Date.now() / 1000) + 86400,
        cancel_at_period_end: false,
        metadata: { user_id: 'user_active' },
        items: { data: [{ price: { id: 'price_pro_monthly', lookup_key: 'pro_monthly' } }] },
      },
    });

    expect(mocks.syncSubscription).toHaveBeenCalled();
    expect(mocks.resolveSubscriptionPlanTier).toHaveBeenCalled();
    expect(mocks.setUserTier).toHaveBeenCalledWith('user_active', 'pro');
  });
});
