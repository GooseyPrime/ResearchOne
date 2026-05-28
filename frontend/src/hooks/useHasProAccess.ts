import { useQueryClient } from '@tanstack/react-query';
import {
  BILLING_SUBSCRIPTION_QUERY_KEY,
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from './useBillingSubscription';

const PRO_PLUS_TIERS = ['pro', 'team', 'byok', 'sovereign', 'admin'] as const;

/** Permissive until tier resolves (PR #94) — includes allowlisted admin. */
export function useHasProAccess(): {
  hasProAccess: boolean;
  tierGateUnknown: boolean;
  isLoading: boolean;
} {
  const queryClient = useQueryClient();
  const cachedAuthMe = queryClient.getQueryData<{ userId: string; isAdmin: boolean }>(['auth', 'me']);
  const isAllowlistedAdmin = cachedAuthMe?.isAdmin === true;

  const subQuery = useBillingSubscriptionQuery();
  const effectiveTier = effectiveEntitlementTier(subQuery.data);
  const tierGateUnknown = subQuery.isLoading || (Boolean(subQuery.isError) && !subQuery.data);
  const hasProAccess =
    isAllowlistedAdmin ||
    tierGateUnknown ||
    Boolean(subQuery.data && effectiveTier && PRO_PLUS_TIERS.includes(effectiveTier as (typeof PRO_PLUS_TIERS)[number]));

  return { hasProAccess, tierGateUnknown, isLoading: subQuery.isLoading };
}

export { PRO_PLUS_TIERS, BILLING_SUBSCRIPTION_QUERY_KEY };
