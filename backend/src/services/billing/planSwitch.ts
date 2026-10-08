import { logger } from '../../utils/logger';
import { getStripeClient, getTierForSubscriptionPrice, isSelfServeSubscriptionTier } from './stripeClient';
import { stripeSubscriptionStatusGrantsPlanAccess } from './stripeSubscriptionStatus';
import { getUserSubscription } from './subscriptionService';
import { resolveUserIdForSubscription, type StripeSubscriptionLike } from './syncStripeSubscription';

/**
 * Moving a subscriber between the self-serve plans (Pro and BYOK, monthly or
 * annual) without a second subscription.
 *
 * The subscriber's one existing Stripe subscription has its single item moved
 * to the new price. Checkout is never used here: a new Checkout would create a
 * second subscription beside the first and bill both.
 *
 * Nothing is written to our own tables. Stripe answers the update with a
 * `customer.subscription.updated` event, and the webhook's existing sync
 * (`syncStripeSubscriptionToUser`) reads the new price and sets the plan. That
 * stays the only place a plan is written.
 */

export type PlanSwitchRefusal =
  | 'target_not_allowed'
  | 'no_active_subscription'
  | 'payment_overdue'
  | 'payment_failed'
  | 'switch_in_progress'
  | 'current_plan_not_self_serve'
  | 'ending_subscription'
  | 'not_owner'
  | 'unsupported_subscription'
  | 'already_on_price';

export type PlanSwitchResult =
  | { ok: true; tier: 'pro' | 'byok' }
  | { ok: false; reason: PlanSwitchRefusal };

/** Words shown to the customer for each refusal. */
export const PLAN_SWITCH_REFUSAL_MESSAGE: Record<PlanSwitchRefusal, string> = {
  target_not_allowed: 'That plan cannot be switched to from this page.',
  no_active_subscription: 'You do not have an active subscription to switch. Choose a plan to subscribe.',
  payment_overdue:
    'Your last payment did not go through. Use "Manage billing in Stripe" to settle it, then switch plans.',
  payment_failed:
    'Your payment method could not be charged for the new plan, so nothing was changed. Use "Manage billing in Stripe" to update it, then try again.',
  switch_in_progress: 'A plan change for your account is already going through. Give it a moment.',
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
  payment_failed: 402,
  switch_in_progress: 409,
  current_plan_not_self_serve: 409,
  ending_subscription: 409,
  not_owner: 403,
  unsupported_subscription: 409,
  already_on_price: 409,
};

/**
 * A plan can be switched only while it is paid up. `past_due` still grants
 * access to the plan elsewhere, but prorating a period whose bill was never
 * paid would hand out credit for service that was not paid for.
 */
function statusAllowsSwitch(status: string): boolean {
  return status === 'active' || status === 'trialing';
}

/** Stripe refused the update because the charge it required did not complete (HTTP 402). */
function isStripePaymentFailure(err: unknown): boolean {
  if (typeof err !== 'object' || err === null) return false;
  const shape = err as { statusCode?: unknown; type?: unknown };
  return shape.statusCode === 402 || shape.type === 'StripeCardError';
}

function priceIdOf(price: string | { id?: string | null } | null | undefined): string | null {
  if (!price) return null;
  return typeof price === 'string' ? price : price.id ?? null;
}

/**
 * The subscription is always found from the signed-in user's own row. A
 * subscription id is never accepted from the request, so there is no id a
 * caller could swap for someone else's.
 */
export async function switchSubscriptionPlan(args: {
  userId: string;
  priceId: string;
}): Promise<PlanSwitchResult> {
  // One switch per user at a time. Two requests arriving together (a double
  // press, two tabs) would otherwise both read the old price and both update.
  // This covers one server process; a second request reaching another process
  // is still stopped by the "already on this price" check once the first lands.
  if (switchesInFlight.has(args.userId)) {
    return { ok: false, reason: 'switch_in_progress' };
  }
  switchesInFlight.add(args.userId);
  try {
    return await performSwitch(args);
  } finally {
    switchesInFlight.delete(args.userId);
  }
}

const switchesInFlight = new Set<string>();

async function performSwitch(args: { userId: string; priceId: string }): Promise<PlanSwitchResult> {
  const { userId } = args;
  const priceId = args.priceId.trim();

  const targetTier = priceId ? getTierForSubscriptionPrice(priceId) : null;
  if (!targetTier || !isSelfServeSubscriptionTier(targetTier)) {
    return { ok: false, reason: 'target_not_allowed' };
  }

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

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(local.stripeSubscriptionId);

  // Second check, against Stripe's own record: the subscription must resolve
  // to this user there too (subscription metadata, then the customer).
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
  if (subscription.cancel_at_period_end) {
    return { ok: false, reason: 'ending_subscription' };
  }
  // Add-on subscriptions (Living Report, Reverse-Citation Watch) are not plans.
  if (subscription.metadata?.monitor_kind) {
    return { ok: false, reason: 'unsupported_subscription' };
  }

  const items = subscription.items.data;
  const item = items[0];
  if (items.length !== 1 || !item?.id) {
    return { ok: false, reason: 'unsupported_subscription' };
  }

  const currentPriceId = priceIdOf(item.price);
  if (currentPriceId === priceId) {
    return { ok: false, reason: 'already_on_price' };
  }
  const currentTier = currentPriceId ? getTierForSubscriptionPrice(currentPriceId) : null;
  if (!currentTier || !isSelfServeSubscriptionTier(currentTier)) {
    return { ok: false, reason: 'current_plan_not_self_serve' };
  }

  try {
    await stripe.subscriptions.update(subscription.id, {
      items: [{ id: item.id, price: priceId }],
      proration_behavior: 'create_prorations',
      // A change of billing period is billed straight away. If that charge
      // does not complete, Stripe must refuse the whole update, so the
      // customer is never moved to a plan they have not paid for. Without
      // this the update would go through and leave the subscription unpaid.
      payment_behavior: 'error_if_incomplete',
      // The webhook reads the plan from the price first and from this value
      // last, so it must not keep naming the plan the customer just left.
      metadata: { tier: targetTier },
    });
  } catch (err) {
    if (isStripePaymentFailure(err)) {
      logger.warn('plan_switch_payment_failed', { userId, stripeSubscriptionId: subscription.id });
      return { ok: false, reason: 'payment_failed' };
    }
    throw err;
  }

  logger.info('plan_switch_requested', {
    userId,
    stripeSubscriptionId: subscription.id,
    fromTier: currentTier,
    toTier: targetTier,
  });

  return { ok: true, tier: targetTier };
}
