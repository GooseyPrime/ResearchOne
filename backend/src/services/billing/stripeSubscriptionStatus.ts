/**
 * Normalized interpretation of Stripe `subscription.status` for ResearchOne.
 * @see https://docs.stripe.com/api/subscriptions/object#subscription_object-status
 */

/** Statuses where the subscriber should receive paid-plan entitlements (app UI + `user_tiers` sync). */
export function stripeSubscriptionStatusGrantsPlanAccess(status: string | null | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'active' || s === 'trialing' || s === 'past_due';
}
