/**
 * POST /api/billing/subscription/switch — a subscriber moves between Pro and
 * BYOK (monthly or annual) — and the pending change that follows it.
 *
 * The rules under test:
 *  - nothing is charged or credited when the customer asks: the subscription
 *    itself is not updated, and its price does not change;
 *  - the change is scheduled for the end of the current billing period with a
 *    Stripe Subscription Schedule made from the existing subscription: the
 *    current phase keeps the current price to the period end, the next phase
 *    carries the new price, and neither prorates;
 *  - one change can be pending at a time;
 *  - "Keep my current plan" releases the schedule, leaving the subscription
 *    as it was;
 *  - only Pro and BYOK prices are accepted as the target, and the subscription
 *    changed is always the signed-in user's own.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState = vi.hoisted(() => ({ userId: 'user_test' as string | null }));

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (
      req: import('express').Request,
      _res: import('express').Response,
      next: import('express').NextFunction,
    ) => {
      if (authState.userId) {
        req.auth = {
          userId: authState.userId,
          orgId: null,
          sessionId: null,
          payload: { email: 'test@example.com' },
        };
      }
      next();
    },
  };
});

const stripeMocks = vi.hoisted(() => ({
  subscriptionsRetrieve: vi.fn(),
  subscriptionsUpdate: vi.fn(),
  subscriptionsCreate: vi.fn(),
  sessionsCreate: vi.fn(),
  schedulesCreate: vi.fn(),
  schedulesUpdate: vi.fn(),
  schedulesRetrieve: vi.fn(),
  schedulesRelease: vi.fn(),
  schedulesCancel: vi.fn(),
  invoicesCreate: vi.fn(),
}));

const PRICE_TIERS: Record<string, string> = {
  price_pro_m: 'pro',
  price_pro_y: 'pro',
  price_byok_m: 'byok',
  price_byok_y: 'byok',
  price_team_m: 'team',
  price_student_m: 'student',
};

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      subscriptions: {
        retrieve: stripeMocks.subscriptionsRetrieve,
        update: stripeMocks.subscriptionsUpdate,
        create: stripeMocks.subscriptionsCreate,
      },
      subscriptionSchedules: {
        create: stripeMocks.schedulesCreate,
        update: stripeMocks.schedulesUpdate,
        retrieve: stripeMocks.schedulesRetrieve,
        release: stripeMocks.schedulesRelease,
        cancel: stripeMocks.schedulesCancel,
      },
      invoices: { create: stripeMocks.invoicesCreate },
      checkout: { sessions: { create: stripeMocks.sessionsCreate } },
    }),
    getTierForSubscriptionPrice: (priceId: string) => PRICE_TIERS[priceId] ?? null,
    getBillingPeriodForSubscriptionPrice: (priceId: string) =>
      priceId.endsWith('_m') ? 'monthly' : priceId.endsWith('_y') ? 'annual' : null,
  };
});

const subscriptionMocks = vi.hoisted(() => ({ getUserSubscription: vi.fn() }));
vi.mock('../services/billing/subscriptionService', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/billing/subscriptionService')>()),
  getUserSubscription: subscriptionMocks.getUserSubscription,
}));

// Only customer → user lookups are faked; the ownership decision itself runs for real.
const customerMocks = vi.hoisted(() => ({
  lookupUserIdByStripeCustomerId: vi.fn(),
  getOrCreateStripeCustomer: vi.fn(),
}));
vi.mock('../services/billing/stripeCustomer', () => customerMocks);

import request from 'supertest';
import testApp from '../api/app';
import { releasePlanSwitchScheduleFor } from '../services/billing/planSwitch';

type LocalRow = {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeSubscriptionId: string | null;
};

function localRow(overrides: Partial<LocalRow> = {}): LocalRow {
  return {
    tier: 'pro',
    status: 'active',
    cancelAtPeriodEnd: false,
    currentPeriodEnd: '2026-11-01T00:00:00.000Z',
    stripeSubscriptionId: 'sub_mine',
    ...overrides,
  };
}

const PERIOD_START = Math.floor(Date.parse('2026-10-01T00:00:00Z') / 1000);
const PERIOD_END = Math.floor(Date.parse('2026-11-01T00:00:00Z') / 1000);

function stripeSubscription(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'sub_mine',
    customer: 'cus_mine',
    status: 'active',
    cancel_at_period_end: false,
    schedule: null,
    metadata: { user_id: 'user_test', tier: 'pro' },
    items: { data: [{ id: 'si_plan', quantity: 1, price: { id: 'price_pro_m' } }] },
    ...overrides,
  };
}

/** What Stripe returns for a schedule made from the subscription: one phase, the current period. */
function freshSchedule(priceId = 'price_pro_m'): Record<string, unknown> {
  return {
    id: 'sub_sched_1',
    status: 'active',
    subscription: 'sub_mine',
    metadata: {},
    current_phase: { start_date: PERIOD_START, end_date: PERIOD_END },
    phases: [{ start_date: PERIOD_START, end_date: PERIOD_END, trial_end: null, discounts: [], items: [{ price: priceId, quantity: 1 }] }],
  };
}

/** A schedule this feature made earlier: the current period, then `toPrice`. */
function pendingSchedule(toPrice: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ...freshSchedule(),
    metadata: { source: 'plan_switch', user_id: 'user_test' },
    phases: [
      { start_date: PERIOD_START, end_date: PERIOD_END, trial_end: null, discounts: [], items: [{ price: 'price_pro_m', quantity: 1 }] },
      { start_date: PERIOD_END, end_date: PERIOD_END + 31 * 86400, trial_end: null, discounts: [], items: [{ price: toPrice, quantity: 1 }] },
    ],
    ...overrides,
  };
}

type PhaseSent = {
  items: Array<{ price: string; quantity: number }>;
  start_date?: number;
  end_date?: number;
  proration_behavior?: string;
  metadata?: Record<string, string>;
  discounts?: unknown;
  duration?: { interval: string; interval_count: number };
  [setting: string]: unknown;
};
type ScheduleUpdateSent = { end_behavior?: string; proration_behavior?: string; metadata?: Record<string, string>; phases: PhaseSent[] };

function scheduleUpdate(): ScheduleUpdateSent {
  return stripeMocks.schedulesUpdate.mock.calls[0]?.[1] as ScheduleUpdateSent;
}

function switchTo(body: Record<string, unknown>) {
  return request(testApp).post('/api/billing/subscription/switch').send(body);
}
const pendingChange = () => request(testApp).get('/api/billing/subscription/pending-change');
const keepCurrentPlan = () => request(testApp).delete('/api/billing/subscription/pending-change');

beforeEach(() => {
  authState.userId = 'user_test';
  for (const mock of Object.values(stripeMocks)) mock.mockReset();
  stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription());
  stripeMocks.schedulesCreate.mockResolvedValue(freshSchedule());
  stripeMocks.schedulesUpdate.mockResolvedValue({ id: 'sub_sched_1' });
  stripeMocks.schedulesRelease.mockResolvedValue({ id: 'sub_sched_1', status: 'released' });
  subscriptionMocks.getUserSubscription.mockReset().mockResolvedValue(localRow());
  customerMocks.lookupUserIdByStripeCustomerId.mockReset().mockResolvedValue(null);
});

describe('nothing changes today', () => {
  it('does not touch the subscription: no price change, no charge, no credit, no invoice', async () => {
    const res = await switchTo({ priceId: 'price_byok_m' });

    expect(res.status).toBe(200);
    // The subscription is never updated directly. An update is the only way
    // its price could change now, and the only way a proration could be made.
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
    expect(stripeMocks.invoicesCreate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsCreate).not.toHaveBeenCalled();
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
    // The price Stripe is told to bill until the period ends is the one the customer already has.
    expect(scheduleUpdate().phases[0]?.items).toEqual([{ price: 'price_pro_m', quantity: 1 }]);
  });

  it('answers with the plan and the date it starts, not with a completed switch', async () => {
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.body).toEqual({
      scheduled: true,
      pendingChange: { tier: 'byok', billingPeriod: 'monthly', effectiveAt: '2026-11-01T00:00:00.000Z' },
    });
    expect(res.body.switched).toBeUndefined();
  });
});

describe('the change is scheduled for the end of the billing period', () => {
  it('makes the schedule from the existing subscription, so there is still one subscription', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    expect(stripeMocks.schedulesCreate).toHaveBeenCalledTimes(1);
    expect(stripeMocks.schedulesCreate).toHaveBeenCalledWith({ from_subscription: 'sub_mine' });
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_mine', { expand: ['schedule'] });
  });

  it('keeps the current price until the period ends, then starts the new price', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    expect(stripeMocks.schedulesUpdate).toHaveBeenCalledTimes(1);
    expect(stripeMocks.schedulesUpdate.mock.calls[0]?.[0]).toBe('sub_sched_1');
    const { phases } = scheduleUpdate();
    expect(phases).toHaveLength(2);
    expect(phases[0]).toMatchObject({
      items: [{ price: 'price_pro_m', quantity: 1 }],
      start_date: PERIOD_START,
      end_date: PERIOD_END,
    });
    expect(phases[1]?.items).toEqual([{ price: 'price_byok_m', quantity: 1 }]);
    // The second phase has no start of its own: it begins where the first ends.
    expect(phases[1]?.start_date).toBeUndefined();
  });

  it('creates no proration, in either phase or for the request itself', async () => {
    await switchTo({ priceId: 'price_pro_y' });
    const sent = scheduleUpdate();
    expect(sent.proration_behavior).toBe('none');
    expect(sent.phases.map((phase) => phase.proration_behavior)).toEqual(['none', 'none']);
    expect(JSON.stringify(sent)).not.toContain('create_prorations');
    expect(JSON.stringify(sent)).not.toContain('always_invoice');
  });

  it('lets the subscription carry on by itself on the new price afterwards', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    expect(scheduleUpdate().end_behavior).toBe('release');
  });

  it('names the new plan on the next phase, so the webhook cannot fall back to the old one', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    const { phases } = scheduleUpdate();
    expect(phases[1]?.metadata).toEqual({ tier: 'byok' });
    expect(phases[0]?.metadata).toBeUndefined();
  });

  it('marks the schedule as a plan change made here', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    expect(scheduleUpdate().metadata).toMatchObject({ source: 'plan_switch', user_id: 'user_test', to_tier: 'byok' });
  });

  it('treats monthly to annual on the same plan the same way', async () => {
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(200);
    expect(res.body.pendingChange).toEqual({ tier: 'pro', billingPeriod: 'annual', effectiveAt: '2026-11-01T00:00:00.000Z' });
    expect(scheduleUpdate().phases.map((phase) => phase.items[0]?.price)).toEqual(['price_pro_m', 'price_pro_y']);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('treats annual to monthly the same way: no credit for the unused part of the year', async () => {
    const yearEnd = PERIOD_START + 365 * 86400;
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ items: { data: [{ id: 'si_plan', quantity: 1, price: { id: 'price_pro_y' } }] } }),
    );
    stripeMocks.schedulesCreate.mockResolvedValue({
      ...freshSchedule('price_pro_y'),
      current_phase: { start_date: PERIOD_START, end_date: yearEnd },
      phases: [{ start_date: PERIOD_START, end_date: yearEnd, trial_end: null, discounts: [], items: [{ price: 'price_pro_y', quantity: 1 }] }],
    });
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(200);
    expect(res.body.pendingChange.effectiveAt).toBe(new Date(yearEnd * 1000).toISOString());
    const sent = scheduleUpdate();
    expect(sent.phases[0]).toMatchObject({ items: [{ price: 'price_pro_y', quantity: 1 }], end_date: yearEnd });
    expect(sent.phases[1]?.items).toEqual([{ price: 'price_pro_m', quantity: 1 }]);
    expect(sent.phases.map((phase) => phase.proration_behavior)).toEqual(['none', 'none']);
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('carries a discount the subscription already has into both phases', async () => {
    stripeMocks.schedulesCreate.mockResolvedValue({
      ...freshSchedule(),
      phases: [{ start_date: PERIOD_START, end_date: PERIOD_END, trial_end: null, discounts: [{ coupon: 'coupon_half', discount: null, promotion_code: null }], items: [{ price: 'price_pro_m', quantity: 1 }] }],
    });
    await switchTo({ priceId: 'price_byok_m' });
    expect(scheduleUpdate().phases.map((phase) => phase.discounts)).toEqual([[{ coupon: 'coupon_half' }], [{ coupon: 'coupon_half' }]]);
  });

  it('bounds the new phase to one billing period of the new price, so the schedule then lets go', async () => {
    await switchTo({ priceId: 'price_byok_m' });
    expect(scheduleUpdate().phases[1]?.duration).toEqual({ interval: 'month', interval_count: 1 });
    expect(scheduleUpdate().phases[0]?.duration).toBeUndefined();

    stripeMocks.schedulesUpdate.mockClear();
    await switchTo({ priceId: 'price_pro_y' });
    expect(scheduleUpdate().phases[1]?.duration).toEqual({ interval: 'year', interval_count: 1 });
  });

  it('writes back how the subscription is taxed, collected and invoiced, on both phases', async () => {
    // Writing phases replaces them; anything left out would be unset by Stripe.
    stripeMocks.schedulesCreate.mockResolvedValue({
      ...freshSchedule(),
      phases: [
        {
          start_date: PERIOD_START,
          end_date: PERIOD_END,
          trial_end: null,
          discounts: [],
          automatic_tax: { enabled: true },
          collection_method: 'charge_automatically',
          default_payment_method: 'pm_card',
          default_tax_rates: [{ id: 'txr_default' }],
          description: 'ResearchOne Pro',
          billing_thresholds: { amount_gte: 5000, reset_billing_cycle_anchor: false },
          invoice_settings: { account_tax_ids: ['atxi_1'], days_until_due: null },
          on_behalf_of: null,
          items: [
            {
              price: 'price_pro_m',
              quantity: 1,
              tax_rates: [{ id: 'txr_item' }],
              billing_thresholds: { usage_gte: 100 },
              metadata: { seat: 'owner' },
              discounts: [{ coupon: 'coupon_item', discount: null, promotion_code: null }],
            },
          ],
        },
      ],
    });
    await switchTo({ priceId: 'price_byok_m' });

    const kept = {
      automatic_tax: { enabled: true },
      collection_method: 'charge_automatically',
      default_payment_method: 'pm_card',
      default_tax_rates: ['txr_default'],
      description: 'ResearchOne Pro',
      billing_thresholds: { amount_gte: 5000, reset_billing_cycle_anchor: false },
      invoice_settings: { account_tax_ids: ['atxi_1'] },
    };
    const keptOnItem = {
      quantity: 1,
      tax_rates: ['txr_item'],
      billing_thresholds: { usage_gte: 100 },
      metadata: { seat: 'owner' },
      discounts: [{ coupon: 'coupon_item' }],
    };
    const { phases } = scheduleUpdate();
    expect(phases[0]).toMatchObject({ ...kept, items: [{ ...keptOnItem, price: 'price_pro_m' }] });
    // The next phase differs in the price and nothing else.
    expect(phases[1]).toMatchObject({ ...kept, items: [{ ...keptOnItem, price: 'price_byok_m' }] });
  });

  it('leaves no schedule behind when Stripe refuses the phases', async () => {
    stripeMocks.schedulesUpdate.mockRejectedValue(Object.assign(new Error('Stripe is unavailable'), { statusCode: 503 }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(res.body.scheduled).toBeUndefined();
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledWith('sub_sched_1');
    expect(stripeMocks.schedulesCancel).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });
});

describe('one pending change at a time', () => {
  it('refuses a second change while one is pending, and schedules nothing', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m') }));
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_CHANGE_ALREADY_PENDING');
    expect(res.body.error).toContain('Keep my current plan');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesUpdate).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('refuses it when Stripe sends the schedule as an id, too', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: 'sub_sched_1' }));
    stripeMocks.schedulesRetrieve.mockResolvedValue(pendingSchedule('price_byok_m'));
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_CHANGE_ALREADY_PENDING');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('does not rewrite a schedule that was not made here', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ schedule: pendingSchedule('price_byok_m', { metadata: {} }) }),
    );
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_UNSUPPORTED_SUBSCRIPTION');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesUpdate).not.toHaveBeenCalled();
  });

  it('accepts a new change once the earlier schedule has been released', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ schedule: pendingSchedule('price_byok_m', { status: 'released' }) }),
    );
    const res = await switchTo({ priceId: 'price_pro_y' });
    expect(res.status).toBe(200);
  });

  it('after an earlier change has taken effect, releases its finished schedule and schedules the next one', async () => {
    // The earlier schedule is still attached, but its new phase is the current one: nothing is pending.
    const finished = pendingSchedule('price_byok_m', {
      id: 'sub_sched_old',
      current_phase: { start_date: PERIOD_END, end_date: PERIOD_END + 31 * 86400 },
    });
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        schedule: finished,
        metadata: { user_id: 'user_test', tier: 'byok' },
        items: { data: [{ id: 'si_plan', quantity: 1, price: { id: 'price_byok_m' } }] },
      }),
    );
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ tier: 'byok' }));
    stripeMocks.schedulesCreate.mockResolvedValue(freshSchedule('price_byok_m'));

    const res = await switchTo({ priceId: 'price_pro_m' });

    expect(res.status).toBe(200);
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledTimes(1);
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledWith('sub_sched_old');
    expect(stripeMocks.schedulesCreate).toHaveBeenCalledWith({ from_subscription: 'sub_mine' });
    expect(scheduleUpdate().phases.map((phase) => phase.items[0]?.price)).toEqual(['price_byok_m', 'price_pro_m']);
    // Released before the new one is made.
    expect(stripeMocks.schedulesRelease.mock.invocationCallOrder[0]).toBeLessThan(
      stripeMocks.schedulesCreate.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('lets one of two requests arriving together through, so one schedule is made', async () => {
    let release: (value: Record<string, unknown>) => void = () => undefined;
    stripeMocks.subscriptionsRetrieve.mockImplementationOnce(
      () => new Promise<Record<string, unknown>>((resolve) => { release = resolve; }),
    );

    const first = switchTo({ priceId: 'price_byok_m' }).then((r) => r);
    await vi.waitFor(() => expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1));
    const second = await switchTo({ priceId: 'price_byok_y' });
    release(stripeSubscription());
    const firstRes = await first;

    expect(firstRes.status).toBe(200);
    expect(second.status).toBe(409);
    expect(second.body.code).toBe('PLAN_SWITCH_SWITCH_IN_PROGRESS');
    expect(stripeMocks.schedulesCreate).toHaveBeenCalledTimes(1);
  });
});

describe('the pending change is shown', () => {
  it('reports the plan, the billing period and the date', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_y') }));
    const res = await pendingChange();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ pendingChange: { tier: 'byok', billingPeriod: 'annual', effectiveAt: '2026-11-01T00:00:00.000Z' } });
  });

  it('reports none when nothing is scheduled', async () => {
    const res = await pendingChange();
    expect(res.body).toEqual({ pendingChange: null });
  });

  it('reports none for a schedule that was not made here, or that has been released', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m', { metadata: {} }) }));
    expect((await pendingChange()).body).toEqual({ pendingChange: null });
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m', { status: 'released' }) }));
    expect((await pendingChange()).body).toEqual({ pendingChange: null });
  });

  it('reports none once the new phase has started: the change is no longer pending', async () => {
    const started = pendingSchedule('price_byok_m', { current_phase: { start_date: PERIOD_END, end_date: PERIOD_END + 31 * 86400 } });
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: started }));
    expect((await pendingChange()).body).toEqual({ pendingChange: null });
  });

  it('reports none to a user with no subscription, without asking Stripe', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ tier: 'free_demo', status: 'inactive', stripeSubscriptionId: null }));
    expect((await pendingChange()).body).toEqual({ pendingChange: null });
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    authState.userId = null;
    expect((await pendingChange()).status).toBe(401);
    expect((await keepCurrentPlan()).status).toBe(401);
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe('"Keep my current plan" cancels the pending change', () => {
  it('releases the schedule, which drops the future phase and leaves the subscription in place', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m') }));
    const res = await keepCurrentPlan();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ cancelled: true });
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledTimes(1);
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledWith('sub_sched_1');
    // Cancelling a schedule would cancel the subscription with it.
    expect(stripeMocks.schedulesCancel).not.toHaveBeenCalled();
    expect(stripeMocks.subscriptionsUpdate).not.toHaveBeenCalled();
  });

  it('says so when there is nothing to cancel', async () => {
    const res = await keepCurrentPlan();
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_NO_PENDING_CHANGE');
    expect(stripeMocks.schedulesRelease).not.toHaveBeenCalled();
  });

  it('does not release a schedule that was not made here', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m', { metadata: {} }) }));
    const res = await keepCurrentPlan();
    expect(res.status).toBe(409);
    expect(stripeMocks.schedulesRelease).not.toHaveBeenCalled();
  });

  it('does not release another user’s schedule', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { user_id: 'user_other', tier: 'pro' }, schedule: pendingSchedule('price_byok_m') }),
    );
    const res = await keepCurrentPlan();
    expect(res.status).toBe(403);
    expect(stripeMocks.schedulesRelease).not.toHaveBeenCalled();
  });
});

describe('only Pro and BYOK can be switched to', () => {
  it.each([
    ['a Team price', 'price_team_m'],
    ['a Student price', 'price_student_m'],
    ['a price this deployment does not sell', 'price_unknown'],
  ])('refuses %s', async (_label, priceId) => {
    const res = await switchTo({ priceId });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('PLAN_SWITCH_TARGET_NOT_ALLOWED');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a request with no price', async () => {
    const res = await switchTo({});
    expect(res.status).toBe(400);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a Team subscriber, whose plan is not self-serve', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ tier: 'team' }));
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_CURRENT_PLAN_NOT_SELF_SERVE');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses when the subscription in Stripe is on a Team price, whatever our own row says', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ items: { data: [{ id: 'si_plan', quantity: 1, price: { id: 'price_team_m' } }] } }),
    );
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });
});

describe('switching to the plan the customer already has is refused', () => {
  it('refuses the same plan and billing period', async () => {
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_ALREADY_ON_PRICE');
    expect(res.body.error).toBe('You are already on this plan and billing period.');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });
});

describe('a user can only switch their own subscription', () => {
  it('ignores a subscription id sent in the request and uses the signed-in user’s own', async () => {
    const res = await switchTo({
      priceId: 'price_byok_m',
      subscriptionId: 'sub_someone_else',
      stripeSubscriptionId: 'sub_someone_else',
      userId: 'user_other',
    });

    expect(res.status).toBe(200);
    expect(subscriptionMocks.getUserSubscription).toHaveBeenCalledWith('user_test');
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledWith('sub_mine', { expand: ['schedule'] });
    expect(stripeMocks.schedulesCreate).toHaveBeenCalledWith({ from_subscription: 'sub_mine' });
  });

  it('refuses when Stripe says the subscription belongs to another user', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { user_id: 'user_other', tier: 'pro' } }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('PLAN_SWITCH_NOT_OWNER');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses when the subscription’s customer is another user’s', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ customer: { id: 'cus_other' }, metadata: {} }),
    );
    customerMocks.lookupUserIdByStripeCustomerId.mockResolvedValue('user_other');
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses when the owner cannot be established at all', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ customer: { id: 'cus_unknown' }, metadata: {} }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(403);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a signed-out caller', async () => {
    authState.userId = null;
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(401);
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });
});

describe('subscriptions that are not switched', () => {
  it('sends a user with no subscription to subscribe instead, touching nothing in Stripe', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(
      localRow({ tier: 'free_demo', status: 'inactive', stripeSubscriptionId: null }),
    );
    const res = await switchTo({ priceId: 'price_pro_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_NO_ACTIVE_SUBSCRIPTION');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a canceled subscription', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ status: 'canceled' }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a subscription whose last payment failed, by our own record', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ status: 'past_due' }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_PAYMENT_OVERDUE');
    expect(stripeMocks.subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a subscription whose last payment failed, by Stripe’s record', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'past_due' }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_PAYMENT_OVERDUE');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('lets a subscriber on a trial switch', async () => {
    subscriptionMocks.getUserSubscription.mockResolvedValue(localRow({ status: 'trialing' }));
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ status: 'trialing' }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(200);
  });

  it('refuses a subscription that is set to end', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ cancel_at_period_end: true }));
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PLAN_SWITCH_ENDING_SUBSCRIPTION');
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses an add-on subscription', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ metadata: { user_id: 'user_test', monitor_kind: 'living_report' } }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });

  it('refuses a subscription with more than one line', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({
        items: {
          data: [
            { id: 'si_plan', quantity: 1, price: { id: 'price_pro_m' } },
            { id: 'si_extra', quantity: 1, price: { id: 'price_other' } },
          ],
        },
      }),
    );
    const res = await switchTo({ priceId: 'price_byok_m' });
    expect(res.status).toBe(409);
    expect(stripeMocks.schedulesCreate).not.toHaveBeenCalled();
  });
});

describe('cancelling a subscription that has a schedule', () => {
  it('releases a plan change scheduled here', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(stripeSubscription({ schedule: pendingSchedule('price_byok_m') }));
    expect(await releasePlanSwitchScheduleFor('sub_mine')).toEqual({ released: true, foreignSchedule: false });
    expect(stripeMocks.schedulesRelease).toHaveBeenCalledWith('sub_sched_1');
  });

  it('leaves a schedule that was not made here alone, and says so', async () => {
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ schedule: pendingSchedule('price_byok_m', { metadata: {} }) }),
    );
    expect(await releasePlanSwitchScheduleFor('sub_mine')).toEqual({ released: false, foreignSchedule: true });
    expect(stripeMocks.schedulesRelease).not.toHaveBeenCalled();
    expect(stripeMocks.schedulesCancel).not.toHaveBeenCalled();
  });

  it('does nothing when there is no schedule, or it has already been released', async () => {
    expect(await releasePlanSwitchScheduleFor('sub_mine')).toEqual({ released: false, foreignSchedule: false });
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(
      stripeSubscription({ schedule: pendingSchedule('price_byok_m', { status: 'released' }) }),
    );
    expect(await releasePlanSwitchScheduleFor('sub_mine')).toEqual({ released: false, foreignSchedule: false });
    expect(stripeMocks.schedulesRelease).not.toHaveBeenCalled();
  });
});
