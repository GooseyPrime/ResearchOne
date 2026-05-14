import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

/** GET /billing/subscription JSON shape (camelCase from the API layer). */
export type BillingSubscription = {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  stripeSubscriptionId?: string | null;
  /** Merged Stripe subscription row + `user_tiers` — use for gating and objective allowlists. */
  effectiveTier: string;
  lifetimeReportsUsed: number;
  lifetimeReportCap: number | null;
};

/** Canonical tier for product gating (subscription view always includes `effectiveTier` from the API). */
export function effectiveEntitlementTier(row: BillingSubscription | undefined): string | undefined {
  if (!row) return undefined;
  return row.effectiveTier ?? row.tier;
}

/** Single observer config for `/billing/subscription` — do not duplicate `useQuery` options elsewhere. */
export const BILLING_SUBSCRIPTION_QUERY_KEY = ['billing-subscription'] as const;

export function useBillingSubscriptionQuery() {
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const authReady = Boolean(authLoaded && isSignedIn);

  const query = useQuery({
    queryKey: BILLING_SUBSCRIPTION_QUERY_KEY,
    queryFn: () => api.get<BillingSubscription>('/billing/subscription').then((r) => r.data),
    enabled: authReady,
    staleTime: 60_000,
    retry: false,
  });

  return { ...query, authReady };
}
