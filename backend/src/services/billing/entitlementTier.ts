import type { TierName } from '../../config/tierRules';
import { maxTierByEntitlementRank, tierNameFromUnknown } from '../../config/tierRules';
import { stripeSubscriptionStatusGrantsPlanAccess } from './stripeSubscriptionStatus';
import type { UserSubscription } from './subscriptionService';

/**
 * Single place that merges Stripe `user_subscriptions` catalog tier with
 * `user_tiers.tier` for objective caps, export gates, and billing UI.
 *
 * When the subscription is not in a paid-access status, entitlements follow
 * `user_tiers` (wallet / admin / sovereign / free_demo). When it is paid-access,
 * we take the higher of the catalog tier and the tier row so a missed
 * `lookup_key` in webhooks cannot strand a paying user on `free_demo` in only
 * one of the two tables.
 */
export function resolveEffectiveEntitlementTier(
  subscription: UserSubscription,
  userTierRowTier: TierName
): TierName {
  const catalog = tierNameFromUnknown(subscription.tier, 'free_demo');
  if (!stripeSubscriptionStatusGrantsPlanAccess(subscription.status)) {
    return maxTierByEntitlementRank(userTierRowTier, 'free_demo');
  }
  return maxTierByEntitlementRank(catalog, userTierRowTier);
}
