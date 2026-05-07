import { query, queryOne } from '../../db/pool';
import { getStripeClient } from './stripeClient';
import { logger } from '../../utils/logger';

export interface UserSubscription {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeSubscriptionId?: string | null;
}

export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  const row = await queryOne<{
    tier: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
    stripe_subscription_id: string | null;
  }>(
    `SELECT tier, status, cancel_at_period_end, current_period_end, stripe_subscription_id
     FROM user_subscriptions
     WHERE user_id = $1`,
    [userId]
  );

  if (!row) {
    return {
      tier: 'free_demo',
      status: 'inactive',
      cancelAtPeriodEnd: false,
      currentPeriodEnd: null,
      stripeSubscriptionId: null,
    };
  }

  return {
    tier: row.tier,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
    stripeSubscriptionId: row.stripe_subscription_id,
  };
}

export async function upsertUserSubscription(input: {
  userId: string;
  tier: string;
  status: string;
  stripeCustomerId?: string | null;
  stripeSubscriptionId?: string | null;
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string | null;
}): Promise<void> {
  await query(
    `INSERT INTO user_subscriptions (
       user_id, tier, status, stripe_customer_id, stripe_subscription_id, cancel_at_period_end, current_period_end, updated_at
     )
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_id)
     DO UPDATE SET
       tier = EXCLUDED.tier,
       status = EXCLUDED.status,
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       stripe_subscription_id = EXCLUDED.stripe_subscription_id,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       current_period_end = EXCLUDED.current_period_end,
       updated_at = NOW()`,
    [
      input.userId,
      input.tier,
      input.status,
      input.stripeCustomerId ?? null,
      input.stripeSubscriptionId ?? null,
      input.cancelAtPeriodEnd ?? false,
      input.currentPeriodEnd ?? null,
    ]
  );
}

/**
 * Maps Stripe price lookup keys to ResearchOne tier names.
 * Called by webhook handlers to determine tier from subscription.
 */
function tierFromPriceLookupKey(lookupKey: string | null | undefined): string {
  if (!lookupKey) return 'free_demo';
  const key = lookupKey.toLowerCase();
  if (key.startsWith('student')) return 'student';
  if (key.startsWith('pro')) return 'pro';
  if (key.startsWith('team')) return 'team';
  if (key.startsWith('byok')) return 'byok';
  return 'free_demo';
}

/**
 * Syncs a Stripe subscription object to the user_subscriptions table.
 * Called by webhook handlers on subscription created/updated events.
 */
export async function syncSubscription(
  userId: string,
  stripeCustomerId: string,
  stripeSubscriptionId: string,
  status: string,
  currentPeriodEnd: Date,
  cancelAtPeriodEnd: boolean,
  priceLookupKey?: string | null
): Promise<void> {
  const tier = tierFromPriceLookupKey(priceLookupKey);

  await upsertUserSubscription({
    userId,
    tier,
    status,
    stripeCustomerId,
    stripeSubscriptionId,
    cancelAtPeriodEnd,
    currentPeriodEnd: currentPeriodEnd.toISOString(),
  });

  logger.info('subscription_synced', {
    userId,
    stripeSubscriptionId,
    tier,
    status,
    cancelAtPeriodEnd,
  });
}

/**
 * Marks a subscription as canceled in the database.
 * Called by webhook handlers on subscription.deleted events.
 */
export async function markSubscriptionCanceled(stripeSubscriptionId: string): Promise<void> {
  await query(
    `UPDATE user_subscriptions
     SET status = 'canceled',
         updated_at = NOW()
     WHERE stripe_subscription_id = $1`,
    [stripeSubscriptionId]
  );

  logger.info('subscription_marked_canceled', { stripeSubscriptionId });
}

/**
 * Requests cancellation of a user's subscription at the end of the current period.
 * Sets cancel_at_period_end=true in both Stripe and the local database.
 * User retains access until period end.
 */
export async function cancelSubscriptionAtPeriodEnd(userId: string): Promise<{ success: boolean; error?: string }> {
  const subscription = await getUserSubscription(userId);

  if (!subscription.stripeSubscriptionId) {
    return { success: false, error: 'No active subscription found' };
  }

  if (subscription.status === 'canceled') {
    return { success: false, error: 'Subscription is already canceled' };
  }

  if (subscription.cancelAtPeriodEnd) {
    return { success: false, error: 'Subscription is already set to cancel at period end' };
  }

  try {
    const stripe = getStripeClient();
    await stripe.subscriptions.update(subscription.stripeSubscriptionId, {
      cancel_at_period_end: true,
    });

    await query(
      `UPDATE user_subscriptions
       SET cancel_at_period_end = true,
           updated_at = NOW()
       WHERE user_id = $1`,
      [userId]
    );

    logger.info('subscription_cancel_requested', {
      userId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
    });

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    logger.error('subscription_cancel_failed', {
      userId,
      stripeSubscriptionId: subscription.stripeSubscriptionId,
      error: message,
    });
    return { success: false, error: message };
  }
}
