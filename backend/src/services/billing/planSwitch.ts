import { logger } from '../../utils/logger';
import {
  getBillingPeriodForSubscriptionPrice,
  getStripeClient,
  getTierForSubscriptionPrice,
  isSelfServeSubscriptionTier,
} from './stripeClient';
import { stripeSubscriptionStatusGrantsPlanAccess } from './stripeSubscriptionStatus';
import { getUserSubscription } from './subscriptionService';
import { resolveUserIdForSubscription, type StripeSubscriptionLike } from './syncStripeSubscription';

/**
 * Moving a subscriber between the self-serve plans (Pro and BYOK, monthly or
 * annual) without a second subscription, and without money moving today.
 *
 * The change is scheduled for the end of the billing period the customer has
 * already paid for. Nothing is charged and nothing is credited when they ask:
 * the subscription keeps its price until the period ends, and the next
 * period is billed at the new price.
 *
 * How: a Stripe Subscription Schedule is made from the subscriber's one
 * existing subscription (`from_subscription`). Its first phase is the current
 * period on the current price; a second phase, starting when the first ends,
 * carries the new price. Neither phase creates an adjustment for part of a
 * period. Checkout is never used: a new Checkout would create a second
 * subscription beside the first and bill both.
 *
 * Nothing is written to our own tables. When the second phase starts, Stripe
 * changes the subscription's price and sends `customer.subscription.updated`;
 * the webhook's existing sync (`syncStripeSubscriptionToUser`) reads the new
 * price and sets the plan. That stays the only place a plan is written, so
 * the plan in the app changes when the new period starts and not before.
 *
 * One change can be pending at a time. The customer can take it back
 * ("Keep my current plan"), which releases the schedule and leaves the
 * subscription exactly as it was.
 */

export type PlanSwitchRefusal =
  | 'target_not_allowed'
  | 'no_active_subscription'
  | 'payment_overdue'
  | 'switch_in_progress'
  | 'change_already_pending'
  | 'no_pending_change'
  | 'current_plan_not_self_serve'
  | 'ending_subscription'
  | 'not_owner'
  | 'unsupported_subscription'
  | 'already_on_price';

export type BillingPeriod = 'monthly' | 'annual';

/** A plan change that has been asked for and has not started yet. */
export interface PendingPlanChange {
  tier: 'pro' | 'byok';
  /** Null when the price is no longer one this deployment lists. */
  billingPeriod: BillingPeriod | null;
  /** When the current period ends and the new plan starts (ISO 8601). */
  effectiveAt: string;
}

export type PlanSwitchResult =
  | ({ ok: true } & PendingPlanChange)
  | { ok: false; reason: PlanSwitchRefusal };

export type CancelPendingChangeResult = { ok: true } | { ok: false; reason: PlanSwitchRefusal };

/** Marks a schedule as one this module made, so no other schedule is ever read as a plan change or released. */
const SCHEDULE_SOURCE = 'plan_switch';

/** Words shown to the customer for each refusal. */
export const PLAN_SWITCH_REFUSAL_MESSAGE: Record<PlanSwitchRefusal, string> = {
  target_not_allowed: 'That plan cannot be switched to from this page.',
  no_active_subscription: 'You do not have an active subscription to switch. Choose a plan to subscribe.',
  payment_overdue:
    'Your last payment did not go through. Use "Manage billing in Stripe" to settle it, then switch plans.',
  switch_in_progress: 'A plan change for your account is already going through. Give it a moment.',
  change_already_pending:
    'You already have a plan change scheduled. Choose "Keep my current plan" first if you want a different one.',
  no_pending_change: 'There is no scheduled plan change to cancel.',
  current_plan_not_self_serve: 'Your current plan cannot be changed from this page. Write to hello@researchone.io.',
  ending_subscription:
    'Your subscription is set to end. Use "Manage billing in Stripe" to keep it, then switch plans.',
  not_owner: 'This subscription does not belong to your account.',
  unsupported_subscription: 'This subscription cannot be changed from this page. Write to hello@researchone.io.',
  already_on_price: 'You are already on this plan and billing period.',
};

export const PLAN_SWITCH_REFUSAL_HTTP_STATUS: Record<PlanSwitchRefusal, number> = {
  target_not_allowed: 400,
  no_active_subscription: 409,
  payment_overdue: 409,
  switch_in_progress: 409,
  change_already_pending: 409,
  no_pending_change: 409,
  current_plan_not_self_serve: 409,
  ending_subscription: 409,
  not_owner: 403,
  unsupported_subscription: 409,
  already_on_price: 409,
};

/**
 * A plan can be switched only while it is paid up. `past_due` still grants
 * access to the plan elsewhere, but a change is not lined up behind a bill
 * that has not been paid.
 */
function statusAllowsSwitch(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

function priceIdOf(price: string | { id?: string | null } | null | undefined): string | null {
  if (!price) return null;
  return typeof price === 'string' ? price : price.id ?? null;
}

type StripeClient = ReturnType<typeof getStripeClient>;
type StripeSubscription = Awaited<ReturnType<StripeClient['subscriptions']['retrieve']>>;
type StripeSchedule = Exclude<NonNullable<StripeSubscription['schedule']>, string>;
type SchedulePhase = StripeSchedule['phases'][number];

function idOf(value: string | { id?: string | null } | null | undefined): string | null {
  if (!value) return null;
  return typeof value === 'string' ? value : value.id ?? null;
}

const inFlight = new Set<string>();

/**
 * One plan request per user at a time. Two requests arriving together (a
 * double press, two tabs) would otherwise both find no schedule and both make
 * one. This covers one server process; a second request reaching another
 * process is refused once the first has attached its schedule.
 */
async function oneAtATime<T extends { ok: boolean }>(
  userId: string,
  work: () => Promise<T>,
): Promise<T | { ok: false; reason: PlanSwitchRefusal }> {
  if (inFlight.has(userId)) return { ok: false, reason: 'switch_in_progress' };
  inFlight.add(userId);
  try {
    return await work();
  } finally {
    inFlight.delete(userId);
  }
}

/**
 * The subscription is always found from the signed-in user's own row. A
 * subscription id is never accepted from the request, so there is no id a
 * caller could swap for someone else's. It is then checked against Stripe's
 * own record: the subscription must resolve to this user there too
 * (subscription metadata, then the customer).
 */
async function loadOwnPlanSubscription(
  stripe: StripeClient,
  userId: string,
): Promise<{ ok: true; subscription: StripeSubscription } | { ok: false; reason: PlanSwitchRefusal }> {
  const local = await getUserSubscription(userId);
  if (!local.stripeSubscriptionId || !stripeSubscriptionStatusGrantsPlanAccess(local.status)) {
    return { ok: false, reason: 'no_active_subscription' };
  }
  if (!statusAllowsSwitch(local.status)) {
    return { ok: false, reason: 'payment_overdue' };
  }
  if (!isSelfServeSubscriptionTier(local.tier)) {
    return { ok: false, reason: 'current_plan_not_self_serve' };
  }

  const subscription = await stripe.subscriptions.retrieve(local.stripeSubscriptionId, { expand: ['schedule'] });

  const stripeOwner = await resolveUserIdForSubscription({
    id: subscription.id,
    customer: subscription.customer as StripeSubscriptionLike['customer'],
    status: subscription.status,
    current_period_end: 0,
    cancel_at_period_end: subscription.cancel_at_period_end,
    metadata: subscription.metadata as StripeSubscriptionLike['metadata'],
  });
  if (stripeOwner !== userId) {
    logger.warn('plan_switch_ownership_mismatch', { userId, stripeSubscriptionId: subscription.id });
    return { ok: false, reason: 'not_owner' };
  }

  if (!stripeSubscriptionStatusGrantsPlanAccess(subscription.status)) {
    return { ok: false, reason: 'no_active_subscription' };
  }
  if (!statusAllowsSwitch(subscription.status)) {
    return { ok: false, reason: 'payment_overdue' };
  }
  // Add-on subscriptions (Living Report, Reverse-Citation Watch) are not plans.
  if (subscription.metadata?.monitor_kind) {
    return { ok: false, reason: 'unsupported_subscription' };
  }
  return { ok: true, subscription };
}

/** The schedule attached to a subscription, whether Stripe sent it whole or as an id. */
async function scheduleOf(stripe: StripeClient, subscription: StripeSubscription): Promise<StripeSchedule | null> {
  const attached = subscription.schedule;
  if (!attached) return null;
  return typeof attached === 'string' ? stripe.subscriptionSchedules.retrieve(attached) : attached;
}

function scheduleIsLive(schedule: StripeSchedule): boolean {
  return schedule.status === 'active' || schedule.status === 'not_started';
}

/** The first phase that has not started: the one a pending change lives in. */
function upcomingPhase(schedule: StripeSchedule): SchedulePhase | null {
  const boundary = schedule.current_phase?.end_date;
  if (!boundary) return null;
  return schedule.phases.find((phase) => phase.start_date >= boundary) ?? null;
}

/** What a live schedule made here will change the plan to, and when. Null for anything else. */
function pendingChangeIn(schedule: StripeSchedule | null): PendingPlanChange | null {
  if (!schedule || !scheduleIsLive(schedule) || schedule.metadata?.source !== SCHEDULE_SOURCE) return null;
  const next = upcomingPhase(schedule);
  const priceId = priceIdOf(next?.items[0]?.price);
  if (!next || !priceId) return null;
  const tier = getTierForSubscriptionPrice(priceId);
  if (!tier || !isSelfServeSubscriptionTier(tier)) return null;
  return {
    tier,
    billingPeriod: getBillingPeriodForSubscriptionPrice(priceId),
    effectiveAt: new Date(next.start_date * 1000).toISOString(),
  };
}

/** A discount as a phase holds it, in the form a phase is written with. */
function carriedDiscounts(phase: SchedulePhase): Array<{ coupon?: string; discount?: string; promotion_code?: string }> {
  const carried: Array<{ coupon?: string; discount?: string; promotion_code?: string }> = [];
  for (const entry of phase.discounts ?? []) {
    const coupon = idOf(entry.coupon);
    // Not expanded here, so Stripe sends the id.
    const discount = typeof entry.discount === 'string' ? entry.discount : null;
    const promotionCode = idOf(entry.promotion_code);
    if (discount) carried.push({ discount });
    else if (promotionCode) carried.push({ promotion_code: promotionCode });
    else if (coupon) carried.push({ coupon });
  }
  return carried;
}

/**
 * Schedules the signed-in user's subscription to move to `priceId` when the
 * current billing period ends. Nothing is charged or credited now.
 */
export async function switchSubscriptionPlan(args: { userId: string; priceId: string }): Promise<PlanSwitchResult> {
  return oneAtATime(args.userId, () => scheduleChange(args));
}

async function scheduleChange(args: { userId: string; priceId: string }): Promise<PlanSwitchResult> {
  const { userId } = args;
  const priceId = args.priceId.trim();

  const targetTier = priceId ? getTierForSubscriptionPrice(priceId) : null;
  if (!targetTier || !isSelfServeSubscriptionTier(targetTier)) {
    return { ok: false, reason: 'target_not_allowed' };
  }

  const stripe = getStripeClient();
  const loaded = await loadOwnPlanSubscription(stripe, userId);
  if (!loaded.ok) return loaded;
  const { subscription } = loaded;

  if (subscription.cancel_at_period_end) {
    return { ok: false, reason: 'ending_subscription' };
  }

  const items = subscription.items.data;
  const item = items[0];
  if (items.length !== 1 || !item?.id) {
    return { ok: false, reason: 'unsupported_subscription' };
  }

  // One pending change at a time. A schedule that was not made here is not
  // ours to rewrite either.
  const existing = await scheduleOf(stripe, subscription);
  if (existing && scheduleIsLive(existing)) {
    return { ok: false, reason: pendingChangeIn(existing) ? 'change_already_pending' : 'unsupported_subscription' };
  }

  const currentPriceId = priceIdOf(item.price);
  if (currentPriceId === priceId) {
    return { ok: false, reason: 'already_on_price' };
  }
  const currentTier = currentPriceId ? getTierForSubscriptionPrice(currentPriceId) : null;
  if (!currentPriceId || !currentTier || !isSelfServeSubscriptionTier(currentTier)) {
    return { ok: false, reason: 'current_plan_not_self_serve' };
  }

  // Step 1: put the subscription under a schedule. Stripe copies the
  // subscription as it stands into one phase covering the current period;
  // this alone changes no price and bills nothing.
  const schedule = await stripe.subscriptionSchedules.create({ from_subscription: subscription.id });
  const current = schedule.phases[0];
  if (!current) {
    await stripe.subscriptionSchedules.release(schedule.id);
    return { ok: false, reason: 'unsupported_subscription' };
  }

  const quantity = item.quantity ?? 1;
  const discounts = carriedDiscounts(current);

  // Step 2: keep the current period as it is and add the next one on the new
  // price. If this fails the schedule from step 1 is released, so a failed
  // request never leaves a schedule behind that would block the next one.
  try {
    await stripe.subscriptionSchedules.update(schedule.id, {
      // After the new phase the subscription carries on by itself, on the new price.
      end_behavior: 'release',
      proration_behavior: 'none',
      metadata: { source: SCHEDULE_SOURCE, user_id: userId, from_tier: currentTier, to_tier: targetTier },
      phases: [
        {
          items: [{ price: currentPriceId, quantity }],
          start_date: current.start_date,
          end_date: current.end_date,
          proration_behavior: 'none',
          ...(current.trial_end ? { trial_end: current.trial_end } : {}),
          ...(discounts.length > 0 ? { discounts } : {}),
        },
        {
          items: [{ price: priceId, quantity }],
          proration_behavior: 'none',
          // Applied to the subscription when this phase starts. The webhook
          // reads the plan from the price first and from this value last, so
          // it must not keep naming the plan the customer has left.
          metadata: { tier: targetTier },
          ...(discounts.length > 0 ? { discounts } : {}),
        },
      ],
    });
  } catch (err) {
    try {
      await stripe.subscriptionSchedules.release(schedule.id);
    } catch (releaseErr) {
      logger.error('plan_switch_schedule_release_failed', {
        userId,
        stripeSubscriptionId: subscription.id,
        stripeScheduleId: schedule.id,
        error: releaseErr instanceof Error ? releaseErr.message : 'Unknown',
      });
    }
    throw err;
  }

  const effectiveAt = new Date(current.end_date * 1000).toISOString();
  logger.info('plan_switch_scheduled', {
    userId,
    stripeSubscriptionId: subscription.id,
    stripeScheduleId: schedule.id,
    fromTier: currentTier,
    toTier: targetTier,
    effectiveAt,
  });

  return { ok: true, tier: targetTier, billingPeriod: getBillingPeriodForSubscriptionPrice(priceId), effectiveAt };
}

/** The signed-in user's scheduled plan change, if there is one. Read from Stripe; nothing is stored here. */
export async function getPendingPlanChange(userId: string): Promise<PendingPlanChange | null> {
  const stripe = getStripeClient();
  const loaded = await loadOwnPlanSubscription(stripe, userId);
  if (!loaded.ok) return null;
  return pendingChangeIn(await scheduleOf(stripe, loaded.subscription));
}

/**
 * "Keep my current plan": the scheduled change is dropped. The schedule is
 * released, which removes its future phase and leaves the subscription in
 * place on the price it has, renewing as before. Nothing is charged or
 * credited. (Releasing, not cancelling: cancelling a schedule would cancel
 * the subscription with it.)
 */
export async function cancelPendingPlanChange(userId: string): Promise<CancelPendingChangeResult> {
  return oneAtATime(userId, async (): Promise<CancelPendingChangeResult> => {
    const stripe = getStripeClient();
    const loaded = await loadOwnPlanSubscription(stripe, userId);
    if (!loaded.ok) return loaded;
    const schedule = await scheduleOf(stripe, loaded.subscription);
    if (!schedule || !pendingChangeIn(schedule)) {
      return { ok: false, reason: 'no_pending_change' };
    }
    await stripe.subscriptionSchedules.release(schedule.id);
    logger.info('plan_switch_pending_change_cancelled', {
      userId,
      stripeSubscriptionId: loaded.subscription.id,
      stripeScheduleId: schedule.id,
    });
    return { ok: true };
  });
}
