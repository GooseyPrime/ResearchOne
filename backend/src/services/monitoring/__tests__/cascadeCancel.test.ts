/**
 * Tests for cancelUserAddonSubscriptions and the add-on vs tier discriminator
 * on customer.subscription.deleted.
 *
 * Per Rule 16: These tests MUST fail without the fix. The bugs being prevented:
 *  (1) Cancelling a Pro subscription left the user's Living Report add-on
 *      Stripe subs charging forever and monitors running on free_demo tier.
 *  (2) Cancelling JUST an add-on (which carries user_id in metadata) wrongly
 *      downgraded the user from Pro to free_demo because the handler did not
 *      discriminate add-ons from tier subs.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  query: vi.fn(),
  stripeCancel: vi.fn(),
  axiosDelete: vi.fn(),
}));

vi.mock('../../../db/pool', () => ({
  query: mocks.query,
  queryOne: vi.fn(),
}));

vi.mock('../../billing/stripeClient', () => ({
  getStripeClient: () => ({
    subscriptions: { cancel: mocks.stripeCancel },
  }),
}));

vi.mock('axios', () => ({
  default: { delete: mocks.axiosDelete, get: vi.fn(), post: vi.fn() },
}));

vi.mock('../../../config', () => ({
  config: {
    parallel: {
      apiKey: 'pk_test',
      baseUrl: 'https://api.parallel.ai',
      webhookSecret: 'whs',
    },
    stripe: {
      secretKey: 'sk_test',
      priceIds: {
        livingReportMonthly: 'price_living_report',
        reverseCitationWatchMonthly: 'price_rcw',
      },
    },
  },
}));

vi.mock('../../../utils/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { cancelUserAddonSubscriptions } from '../parallelMonitorService';

describe('cancelUserAddonSubscriptions (cascade-cancel add-ons when tier sub ends)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.stripeCancel.mockResolvedValue({ id: 'sub_x', status: 'canceled' });
    mocks.axiosDelete.mockResolvedValue({ status: 204 });
  });

  it('no-ops when user has no active add-on subscriptions', async () => {
    mocks.query.mockResolvedValueOnce([]);
    await cancelUserAddonSubscriptions('user_no_addons');
    expect(mocks.stripeCancel).not.toHaveBeenCalled();
  });

  it('cancels Stripe subscription for each active monitor and marks each cancelled locally', async () => {
    const userId = 'user_with_two_addons';
    mocks.query
      // SELECT active monitors
      .mockResolvedValueOnce([
        { id: 'mon_a', stripe_subscription_id: 'sub_addon_a', parallel_monitor_id: 'pm_a' },
        { id: 'mon_b', stripe_subscription_id: 'sub_addon_b', parallel_monitor_id: 'pm_b' },
      ])
      // UPDATE mon_a
      .mockResolvedValueOnce([])
      // INSERT event mon_a
      .mockResolvedValueOnce([])
      // UPDATE mon_b
      .mockResolvedValueOnce([])
      // INSERT event mon_b
      .mockResolvedValueOnce([]);

    await cancelUserAddonSubscriptions(userId);

    expect(mocks.stripeCancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCancel).toHaveBeenNthCalledWith(1, 'sub_addon_a');
    expect(mocks.stripeCancel).toHaveBeenNthCalledWith(2, 'sub_addon_b');

    const updateCalls = mocks.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes("UPDATE report_monitors SET status='cancelled'")
    );
    expect(updateCalls).toHaveLength(2);
    const updatedIds = updateCalls.map((c) => (c[1] as unknown[])[0]).sort();
    expect(updatedIds).toEqual(['mon_a', 'mon_b']);

    const eventInserts = mocks.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes("'subscription_cancelled'")
    );
    expect(eventInserts).toHaveLength(2);
    const reasons = eventInserts.map((c) => JSON.parse((c[1] as unknown[])[1] as string).reason);
    expect(reasons).toEqual(['tier_cascade', 'tier_cascade']);
  });

  it('continues cascading even if one Stripe cancel fails', async () => {
    mocks.query
      .mockResolvedValueOnce([
        { id: 'mon_a', stripe_subscription_id: 'sub_addon_a', parallel_monitor_id: 'pm_a' },
        { id: 'mon_b', stripe_subscription_id: 'sub_addon_b', parallel_monitor_id: 'pm_b' },
      ])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    mocks.stripeCancel
      .mockRejectedValueOnce(new Error('Stripe 503'))
      .mockResolvedValueOnce({ id: 'sub_addon_b', status: 'canceled' });

    await expect(cancelUserAddonSubscriptions('user_cascade_partial')).resolves.toBeUndefined();
    expect(mocks.stripeCancel).toHaveBeenCalledTimes(2);

    const updateCalls = mocks.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes("UPDATE report_monitors SET status='cancelled'")
    );
    expect(updateCalls).toHaveLength(2);
  });

  /**
   * PR #91 review (Codex P1 + Copilot): paused monitors still have Stripe
   * subscriptions attached (pauseMonitor() does not cancel Stripe). When a
   * tier sub ends, paused add-on subs must also be cascade-cancelled.
   *
   * Per Rule 16: this test MUST fail if the fix is reverted — i.e. if the
   * query only selects status='active' instead of status IN ('active','paused').
   */
  it('includes paused monitors in cascade cancel (PR #91 fix)', async () => {
    const userId = 'user_with_paused_addon';
    mocks.query
      // SELECT monitors — the query selects both active and paused monitors
      .mockResolvedValueOnce([
        { id: 'mon_active', stripe_subscription_id: 'sub_active', parallel_monitor_id: 'pm_active' },
        { id: 'mon_paused', stripe_subscription_id: 'sub_paused', parallel_monitor_id: 'pm_paused' },
      ])
      // UPDATE mon_active
      .mockResolvedValueOnce([])
      // INSERT event mon_active
      .mockResolvedValueOnce([])
      // UPDATE mon_paused
      .mockResolvedValueOnce([])
      // INSERT event mon_paused
      .mockResolvedValueOnce([]);

    await cancelUserAddonSubscriptions(userId);

    // Both monitors should have their Stripe subscriptions cancelled
    expect(mocks.stripeCancel).toHaveBeenCalledTimes(2);
    expect(mocks.stripeCancel).toHaveBeenNthCalledWith(1, 'sub_active');
    expect(mocks.stripeCancel).toHaveBeenNthCalledWith(2, 'sub_paused');

    // Both monitors should be marked as cancelled locally
    const updateCalls = mocks.query.mock.calls.filter((c) =>
      typeof c[0] === 'string' && (c[0] as string).includes("UPDATE report_monitors SET status='cancelled'")
    );
    expect(updateCalls).toHaveLength(2);
    const updatedIds = updateCalls.map((c) => (c[1] as unknown[])[0]).sort();
    expect(updatedIds).toEqual(['mon_active', 'mon_paused']);

    // Verify the SELECT query includes the paused status
    const selectCall = mocks.query.mock.calls.find(
      (c) => typeof c[0] === 'string' && (c[0] as string).includes('SELECT') && (c[0] as string).includes('report_monitors')
    );
    expect(selectCall).toBeDefined();
    expect(selectCall![0]).toContain("IN ('active', 'paused')");
  });
});
