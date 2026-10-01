import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';
import { getStripeClient } from './stripeClient';

/**
 * Stripe reports a customer that no longer exists in two ways: a retrieve that
 * returns `{ deleted: true }`, or a `resource_missing` error for an id it never
 * had (for example one created in another mode or account).
 */
async function storedCustomerIsGone(customerId: string, userId: string): Promise<boolean> {
  try {
    const customer = await getStripeClient().customers.retrieve(customerId);
    return Boolean((customer as { deleted?: boolean }).deleted);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code === 'resource_missing') return true;
    // A transient Stripe failure is not evidence the customer is gone. Keep the
    // stored id; checkout will surface the real error if there is one.
    logger.warn('stripe_customer_check_failed_keeping_stored_id', { userId, customerId, err });
    return false;
  }
}

/**
 * Returns a persistent Stripe Customer id for the Clerk user (1:1 mapping in stripe_customers).
 *
 * The stored id is checked against Stripe before it is reused. A customer that
 * was deleted in Stripe made every checkout for that user fail with
 * "No such customer"; such an id is now replaced and the mapping updated.
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
      if (!(await storedCustomerIsGone(existing.stripe_customer_id, userId))) {
        return existing.stripe_customer_id;
      }
      logger.warn('stripe_customer_stale_replacing', { userId, staleCustomerId: existing.stripe_customer_id });
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
