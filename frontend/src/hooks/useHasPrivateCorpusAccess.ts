import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
import {
  BILLING_SUBSCRIPTION_QUERY_KEY,
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
} from './useBillingSubscription';

/** Tiers with `corpusAccess` in backend tierRules (private Ingest workspace). */
export const PRIVATE_CORPUS_TIERS = ['pro', 'team', 'byok', 'sovereign', 'admin'] as const;

/** Permissive until tier resolves — includes allowlisted admin (same pattern as Layout). */
export function useHasPrivateCorpusAccess(): {
  hasPrivateCorpusAccess: boolean;
  /** True only while the billing subscription query is loading (not on fetch error). */
  tierGateUnknown: boolean;
  /** Subscription query failed with no cached data — show error UI, not infinite loading. */
  subscriptionUnavailable: boolean;
  isLoading: boolean;
} {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();

  const { data: authMe } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ userId: string; isAdmin: boolean }>('/auth/me').then((r) => r.data),
    enabled: Boolean(authLoaded && isSignedIn),
    staleTime: 60_000,
    retry: false,
  });
  const isAllowlistedAdmin = authMe?.isAdmin === true;

  const subQuery = useBillingSubscriptionQuery();
  const effectiveTier = effectiveEntitlementTier(subQuery.data);
  const tierGateUnknown = subQuery.isLoading;
  const subscriptionUnavailable = Boolean(subQuery.isError) && !subQuery.data;
  const hasPrivateCorpusAccess =
    isAllowlistedAdmin ||
    tierGateUnknown ||
    Boolean(
      subQuery.data &&
        effectiveTier &&
        PRIVATE_CORPUS_TIERS.includes(effectiveTier as (typeof PRIVATE_CORPUS_TIERS)[number])
    );

  return {
    hasPrivateCorpusAccess,
    tierGateUnknown,
    subscriptionUnavailable,
    isLoading: subQuery.isLoading,
  };
}

export { BILLING_SUBSCRIPTION_QUERY_KEY };
