import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';
import { getStripeClient } from './stripeClient';

/**
 * Returns a persistent Stripe Customer id for the Clerk user (1:1 mapping in stripe_customers).
 */
export async function getOrCreateStripeCustomer(
  userId: string,
  email: string | null
): Promise<string> {
  try {
    const existing = await queryOne<{ stripe_customer_id: string }>(
      'SELECT stripe_customer_id FROM stripe_customers WHERE user_id = $1',
      [userId]
    );
    if (existing?.stripe_customer_id) {
      return existing.stripe_customer_id;
    }
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.warn('stripe_customers table missing — creating ephemeral Stripe customer', { userId });
      const stripe = getStripeClient();
      const customer = await stripe.customers.create({
        email: email ?? undefined,
        metadata: { user_id: userId },
      });
      return customer.id;
    }
    throw err;
  }

  const stripe = getStripeClient();
  const search = await stripe.customers
    .search({ query: `metadata['user_id']:'${userId.replace(/'/g, "\\'")}'` })
    .catch(() => ({ data: [] as { id: string }[] }));

  const customer =
    search.data[0] ??
    (await stripe.customers.create({
      email: email ?? undefined,
      metadata: { user_id: userId },
    }));

  try {
    await query(
      `INSERT INTO stripe_customers (user_id, stripe_customer_id)
       VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET stripe_customer_id = EXCLUDED.stripe_customer_id`,
      [userId, customer.id]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      logger.warn('stripe_customers insert skipped — returning Stripe id only', { userId });
    } else {
      throw err;
    }
  }

  return customer.id;
}

export async function lookupUserIdByStripeCustomerId(
  stripeCustomerId: string
): Promise<string | null> {
  try {
    const row = await queryOne<{ user_id: string }>(
      'SELECT user_id FROM stripe_customers WHERE stripe_customer_id = $1',
      [stripeCustomerId]
    );
    return row?.user_id ?? null;
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01' || pgCode === '42703') {
      return null;
    }
    throw err;
  }
}
