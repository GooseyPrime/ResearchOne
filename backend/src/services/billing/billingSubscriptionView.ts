import { TIER_RULES } from '../../config/tierRules';
import { resolveEffectiveEntitlementTier } from './entitlementTier';
import { getUserSubscription, type UserSubscription } from './subscriptionService';

/** `/billing/subscription` response: Stripe row + merged entitlement + usage snapshot. */
export interface BillingSubscriptionView extends UserSubscription {
  effectiveTier: string;
  lifetimeReportsUsed: number;
  lifetimeReportCap: number | null;
  currentPeriodReportsUsed: number;
  monthlyReportCap: number | null;
  currentPeriodDeepReportsUsed: number;
  monthlyDeepReportCap: number | null;
}

export async function getBillingSubscriptionView(userId: string): Promise<BillingSubscriptionView> {
  const { getOrCreateUserTier } = await import('../tier/tierService');
  const [subscription, row] = await Promise.all([
    getUserSubscription(userId),
    getOrCreateUserTier(userId),
  ]);
  const effectiveTier = resolveEffectiveEntitlementTier(subscription, row.tier);
  const rules = TIER_RULES[effectiveTier] ?? TIER_RULES.free_demo;
  return {
    ...subscription,
    effectiveTier,
    lifetimeReportsUsed: row.lifetime_reports_used,
    lifetimeReportCap: rules.lifetimeReportCap,
    currentPeriodReportsUsed: row.current_period_reports_used,
    monthlyReportCap: rules.monthlyReportCap,
    currentPeriodDeepReportsUsed: row.current_period_deep_reports_used,
    monthlyDeepReportCap: rules.monthlyDeepReportCap,
  };
}
