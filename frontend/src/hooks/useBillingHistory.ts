import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';

export type BillingHistoryItem = {
  kind: 'subscription' | 'wallet';
  id: string;
  occurred_at: string;
  description: string;
  amount_cents: number | null;
  currency: string | null;
  status: 'paid' | 'failed' | 'credit' | 'debit' | 'info';
};

export const BILLING_HISTORY_QUERY_KEY = ['billing-history'] as const;

export function useBillingHistory(limit = 25) {
  const { isLoaded, isSignedIn } = useAuth();

  return useQuery({
    queryKey: [...BILLING_HISTORY_QUERY_KEY, limit],
    queryFn: async () =>
      (await api.get<{ items: BillingHistoryItem[]; total: number }>('/billing/history', { params: { limit } }))
        .data,
    enabled: Boolean(isLoaded && isSignedIn),
    staleTime: 30_000,
    retry: false,
  });
}
