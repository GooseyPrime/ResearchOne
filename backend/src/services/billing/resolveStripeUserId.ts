import { getStripeClient } from './stripeClient';
import { lookupUserIdByStripeCustomerId } from './stripeCustomer';
import { logger } from '../../utils/logger';

export interface StripeIdentitySurfaces {
  metadata?: { user_id?: string; userId?: string } | null;
  client_reference_id?: string | null;
  customer?: string | { id?: string; metadata?: { user_id?: string } } | null;
}

/**
 * Resolves Clerk user id from Stripe subscription/session identity surfaces.
 */
export async function resolveUserIdFromStripeIdentity(
  surfaces: StripeIdentitySurfaces
): Promise<string | null> {
  const fromMeta = surfaces.metadata?.user_id ?? surfaces.metadata?.userId ?? null;
  if (fromMeta) return fromMeta;

  if (surfaces.client_reference_id) {
    return surfaces.client_reference_id;
  }

  const customer = surfaces.customer;
  if (!customer) return null;

  if (typeof customer === 'string') {
    const fromTable = await lookupUserIdByStripeCustomerId(customer);
    if (fromTable) return fromTable;
    try {
      const stripe = getStripeClient();
      const expanded = await stripe.customers.retrieve(customer);
      if (!expanded.deleted && 'metadata' in expanded) {
        const uid = expanded.metadata?.user_id;
        if (uid) return uid;
      }
    } catch (err) {
      logger.warn('stripe_customer_expand_failed', {
        customerId: customer,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
    return null;
  }

  const uid = customer.metadata?.user_id;
  if (uid) return uid;

  const customerId = customer.id;
  if (!customerId) return null;

  const fromTable = await lookupUserIdByStripeCustomerId(customerId);
  return fromTable;
}
