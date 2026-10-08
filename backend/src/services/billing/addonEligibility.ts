import { config } from '../../config';
import type { TierName } from '../../config/tierRules';
import { getBillingSubscriptionView } from './billingSubscriptionView';

/**
 * Plans that may buy add-ons. The pricing page tells the visitor "Add-ons
 * require an active Pro, BYOK, Team, or Sovereign subscription", and the
 * browser hides the buttons for everyone else. Hiding a button is not a rule:
 * the checkout routes ask this module, so the sentence on the page is true
 * for a request made by hand as well.
 */
export const ADDON_ELIGIBLE_TIERS: readonly TierName[] = ['pro', 'byok', 'team', 'sovereign', 'admin'];

export function tierIsAddonEligible(tier: string): boolean {
  return (ADDON_ELIGIBLE_TIERS as readonly string[]).includes(tier);
}

export interface AddonEligibility {
  eligible: boolean;
  tier: string;
}

/**
 * Uses the same merged tier the billing page shows (`effectiveTier`), so a
 * user is never told "you are on Pro" by one endpoint and refused as "not on
 * Pro" by another. Allowlisted admins are eligible whatever their tier row says.
 */
export async function resolveAddonEligibility(userId: string): Promise<AddonEligibility> {
  if (config.admin.userIds.includes(userId)) {
    return { eligible: true, tier: 'admin' };
  }
  const view = await getBillingSubscriptionView(userId);
  return { eligible: tierIsAddonEligible(view.effectiveTier), tier: view.effectiveTier };
}

export const ADDON_SUBSCRIPTION_REQUIRED_MESSAGE =
  'Add-ons require an active Pro, BYOK, Team, or Sovereign subscription';
