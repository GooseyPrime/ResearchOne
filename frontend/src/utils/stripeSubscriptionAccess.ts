/**
 * Matches backend `stripeSubscriptionStatusGrantsPlanAccess` — keep in sync when changing.
 * @see https://docs.stripe.com/api/subscriptions/object#subscription_object-status
 */
export function stripeSubscriptionGrantsPaidPlan(status: string | undefined): boolean {
  if (!status) return false;
  const s = status.toLowerCase();
  return s === 'active' || s === 'trialing' || s === 'past_due';
}
