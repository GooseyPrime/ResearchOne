import { TIER_RULES } from '../../config/tierRules';
import { getUserTier } from '../tier/tierService';
import { resolveEffectiveEntitlementTier } from './entitlementTier';
import { getUserSubscription, type UserSubscription } from './subscriptionService';

/** `/billing/subscription` response: Stripe row + merged entitlement + usage snapshot. */
export interface BillingSubscriptionView extends UserSubscription {
  effectiveTier: string;
  lifetimeReportsUsed: number;
  lifetimeReportCap: number | null;
}

export async function getBillingSubscriptionView(userId: string): Promise<BillingSubscriptionView> {
  const [subscription, row] = await Promise.all([getUserSubscription(userId), getUserTier(userId)]);
  const effectiveTier = resolveEffectiveEntitlementTier(subscription, row.tier);
  const rules = TIER_RULES[effectiveTier] ?? TIER_RULES.free_demo;
  return {
    ...subscription,
    effectiveTier,
    lifetimeReportsUsed: row.lifetime_reports_used,
    lifetimeReportCap: rules.lifetimeReportCap,
  };
}
