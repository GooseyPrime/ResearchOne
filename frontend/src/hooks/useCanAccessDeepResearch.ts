import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import { effectiveEntitlementTier, useBillingSubscriptionQuery } from './useBillingSubscription';
const FREE_TIERS_BLOCKING_DEEP_UI = new Set(['free_demo', 'anonymous']);

/**
 * Whether the user may switch the unified research console into Deep (V2) mode.
 * Permissive while tier is unknown (Rule 94). Upsell free_demo before they fill the V2 form.
 * Student / wallet / pro tiers may use Deep (API caps still apply on submit).
 */
export function useCanAccessDeepResearch(): {
  canAccessDeep: boolean;
  tierGateUnknown: boolean;
} {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  const authMeQuery = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ userId: string; isAdmin: boolean }>('/auth/me').then((r) => r.data),
    enabled: Boolean(authLoaded && isSignedIn),
    staleTime: 60_000,
    retry: false,
  });
  const authMe = authMeQuery.data;
  const isAllowlistedAdmin = authMe?.isAdmin === true;

  const subQuery = useBillingSubscriptionQuery();
  const effectiveTier = effectiveEntitlementTier(subQuery.data);
  const authMeGateUnknown = Boolean(authLoaded && isSignedIn && authMeQuery.isLoading);
  const tierGateUnknown =
    authMeGateUnknown || subQuery.isLoading || (Boolean(subQuery.isError) && !subQuery.data);

  const tierBlocksDeep =
    Boolean(subQuery.data && effectiveTier && FREE_TIERS_BLOCKING_DEEP_UI.has(effectiveTier));

  const canAccessDeep = tierGateUnknown || isAllowlistedAdmin || !tierBlocksDeep;

  return { canAccessDeep, tierGateUnknown };
}
