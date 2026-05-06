import { query, queryOne } from '../../db/pool';

export interface UserSubscription {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

export async function getUserSubscription(userId: string): Promise<UserSubscription> {
  const row = await queryOne<{
    tier: string;
    status: string;
    cancel_at_period_end: boolean;
    current_period_end: string | null;
  }>(
    `SELECT tier, status, cancel_at_period_end, current_period_end
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
    };
  }

  return {
    tier: row.tier,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
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
