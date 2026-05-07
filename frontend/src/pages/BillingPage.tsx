import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../utils/api';
import { startCheckoutRedirect } from '../lib/billing/checkout';

type WalletResponse = {
  balanceCents: number;
  currency: string;
  history: Array<{
    id: number;
    amount_cents: number;
    entry_type: 'credit' | 'debit';
    description: string;
    created_at: string;
    balance_after_cents?: number;
  }>;
};

type SubscriptionResponse = {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
};

type TopupOption = {
  priceId: string;
  amountCents: number;
  label: string;
};

type SubscriptionOption = {
  tier: string;
  label: string;
  monthlyPriceId: string;
  annualPriceId: string;
  monthlyAmountCents: number;
  annualAmountCents: number;
};

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

function formatTimestamp(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return dateStr;
  }
}

export default function BillingPage() {
  const queryClient = useQueryClient();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const walletQuery = useQuery({
    queryKey: ['billing-wallet'],
    queryFn: async () => (await api.get<WalletResponse>('/billing/wallet')).data,
  });

  const subQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: async () => (await api.get<SubscriptionResponse>('/billing/subscription')).data,
  });

  const topupOptionsQuery = useQuery({
    queryKey: ['billing-topup-options'],
    queryFn: async () => (await api.get<{ options: TopupOption[] }>('/billing/topup-options')).data,
  });

  const subscriptionOptionsQuery = useQuery({
    queryKey: ['billing-subscription-options'],
    queryFn: async () => (await api.get<{ options: SubscriptionOption[] }>('/billing/subscription-options')).data,
  });

  const cancelMutation = useMutation({
    mutationFn: async () => {
      const res = await api.post<{ success: boolean; error?: string }>('/billing/cancel-subscription', {});
      if (!res.data.success) {
        throw new Error(res.data.error || 'Failed to cancel subscription');
      }
      return res.data;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      setCancelError(null);
    },
    onError: (err: unknown) => {
      setCancelError(extractApiError(err));
    },
  });

  const balance = useMemo(() => ((walletQuery.data?.balanceCents ?? 0) / 100).toFixed(2), [walletQuery.data]);

  const hasActiveSubscription =
    subQuery.data && subQuery.data.status === 'active' && subQuery.data.tier !== 'free_demo';
  const canCancel = hasActiveSubscription && !subQuery.data?.cancelAtPeriodEnd;

  return (
    <div className="mx-auto max-w-5xl p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Billing</h1>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Wallet</h2>
        <p className="mt-2 text-sm text-slate-400">
          Balance: {walletQuery.data?.currency?.toUpperCase() ?? 'USD'} ${balance}
        </p>
        {checkoutError ? <p className="mt-2 text-sm text-red-400">{checkoutError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {(topupOptionsQuery.data?.options ?? []).map((option) => (
            <button
              key={option.priceId}
              className="rounded bg-indigo-600 px-3 py-2 text-sm hover:bg-indigo-500 transition-colors"
              onClick={() => {
                setCheckoutError(null);
                void startCheckoutRedirect('/billing/checkout/topup', {
                  priceId: option.priceId,
                }).catch((e) => setCheckoutError(e instanceof Error ? e.message : 'Checkout failed'));
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Subscription</h2>
        {subQuery.data && (
          <div className="mt-2">
            <p className="text-sm text-slate-400">
              <span className="font-medium text-slate-200">Tier:</span>{' '}
              <span className="capitalize">{subQuery.data.tier}</span>
              {' · '}
              <span className="font-medium text-slate-200">Status:</span>{' '}
              <span className="capitalize">{subQuery.data.status}</span>
            </p>
            {subQuery.data.currentPeriodEnd && subQuery.data.status === 'active' && (
              <p className="mt-1 text-sm text-slate-400">
                {subQuery.data.cancelAtPeriodEnd ? (
                  <span className="text-amber-400">
                    Access until: {formatDate(subQuery.data.currentPeriodEnd)}
                  </span>
                ) : (
                  <span>Renews: {formatDate(subQuery.data.currentPeriodEnd)}</span>
                )}
              </p>
            )}
            {cancelError && <p className="mt-2 text-sm text-red-400">{cancelError}</p>}
            {canCancel && (
              <button
                className="mt-3 rounded border border-red-600 px-3 py-1.5 text-sm text-red-400 hover:bg-red-600/10 transition-colors disabled:opacity-50"
                onClick={() => cancelMutation.mutate()}
                disabled={cancelMutation.isPending}
              >
                {cancelMutation.isPending ? 'Canceling...' : 'Cancel subscription'}
              </button>
            )}
          </div>
        )}

        {(!hasActiveSubscription && (subscriptionOptionsQuery.data?.options ?? []).length > 0) && (
          <div className="mt-4">
            <p className="text-sm text-slate-400 mb-3">Upgrade to a subscription plan:</p>
            <div className="grid gap-3 sm:grid-cols-2">
              {(subscriptionOptionsQuery.data?.options ?? []).map((option) => (
                <div
                  key={option.tier}
                  className="rounded-lg border border-white/10 bg-slate-800/50 p-4"
                >
                  <h3 className="font-medium">{option.label}</h3>
                  <p className="text-sm text-slate-400 mt-1">
                    ${(option.monthlyAmountCents / 100).toFixed(0)}/mo or $
                    {(option.annualAmountCents / 100).toFixed(0)}/yr
                  </p>
                  <div className="mt-3 flex gap-2">
                    {option.monthlyPriceId && (
                      <button
                        className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 transition-colors"
                        onClick={() => {
                          setCheckoutError(null);
                          void startCheckoutRedirect('/billing/checkout/subscription', {
                            priceId: option.monthlyPriceId,
                            tier: option.tier,
                          }).catch((e) =>
                            setCheckoutError(e instanceof Error ? e.message : 'Checkout failed')
                          );
                        }}
                      >
                        Monthly
                      </button>
                    )}
                    {option.annualPriceId && (
                      <button
                        className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500 transition-colors"
                        onClick={() => {
                          setCheckoutError(null);
                          void startCheckoutRedirect('/billing/checkout/subscription', {
                            priceId: option.annualPriceId,
                            tier: option.tier,
                          }).catch((e) =>
                            setCheckoutError(e instanceof Error ? e.message : 'Checkout failed')
                          );
                        }}
                      >
                        Annual (save 17%)
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Recent transactions</h2>
        {(walletQuery.data?.history ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No transactions yet</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {(walletQuery.data?.history ?? []).map((row) => (
              <li key={row.id} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                <div className="flex-1 min-w-0">
                  <span>{row.description}</span>
                  <span className="ml-2 text-xs text-slate-500">{formatTimestamp(row.created_at)}</span>
                </div>
                <div className="flex items-center gap-3 text-right">
                  <span className={row.entry_type === 'credit' ? 'text-emerald-400' : 'text-red-400'}>
                    {row.entry_type === 'credit' ? '+' : '-'}${(row.amount_cents / 100).toFixed(2)}
                  </span>
                  {row.balance_after_cents != null && (
                    <span className="text-xs text-slate-500 w-16">
                      ${(row.balance_after_cents / 100).toFixed(2)}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
