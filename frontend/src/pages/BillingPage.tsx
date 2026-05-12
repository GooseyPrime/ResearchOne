import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import api, { extractApiError, listUserMonitors, type ReportMonitorRow } from '../utils/api';
import { startCheckoutRedirect } from '../lib/billing/checkout';
import { stripeSubscriptionGrantsPaidPlan } from '../utils/stripeSubscriptionAccess';

const ADDON_PRICE_LABEL: Record<ReportMonitorRow['monitor_kind'], string> = {
  living_report: 'Living Report — $19/mo',
  reverse_citation_watch: 'Reverse-Citation Watch — $15/mo',
};

const ADDON_KIND_LABEL: Record<ReportMonitorRow['monitor_kind'], string> = {
  living_report: 'Living Report',
  reverse_citation_watch: 'Reverse-Citation Watch',
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);

  useEffect(() => {
    const checkout = searchParams.get('checkout');
    if (checkout === 'success') {
      void queryClient.invalidateQueries({ queryKey: ['billing-subscription'] });
      void queryClient.invalidateQueries({ queryKey: ['billing-wallet'] });
    }
    if (checkout === 'success' || checkout === 'cancel') {
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      setSearchParams(next, { replace: true });
    }
  }, [queryClient, searchParams, setSearchParams]);

  const cachedAuthMe = queryClient.getQueryData<{ userId: string; isAdmin: boolean }>(['auth', 'me']);
  const isAllowlistedAdmin = cachedAuthMe?.isAdmin === true;

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
    subQuery.data &&
    stripeSubscriptionGrantsPaidPlan(subQuery.data.status) &&
    subQuery.data.tier !== 'free_demo';
  const canCancel = hasActiveSubscription && !subQuery.data?.cancelAtPeriodEnd;

  const PRO_PLUS_TIERS = ['pro', 'team', 'byok', 'sovereign', 'admin'];
  const hasProAccess = isAllowlistedAdmin || (subQuery.data
    ? PRO_PLUS_TIERS.includes(subQuery.data.tier) && stripeSubscriptionGrantsPaidPlan(subQuery.data.status)
    : false);

  const monitorsQuery = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: () => listUserMonitors(),
    retry: false,
    enabled: hasProAccess,
  });

  return (
    <div className="mx-auto max-w-5xl p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Account</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Checkout opens on Stripe, where you can enter a promotion code if you have one for an eligible
        purchase. For subscriptions (plans and report add-ons), Stripe omits payment details when the
        amount due is $0 after discounts.
      </p>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Wallet</h2>
        <p className="mt-2 text-sm text-slate-400">
          Balance: {walletQuery.data?.currency?.toUpperCase() ?? 'USD'} ${balance}
        </p>
        {checkoutError ? <p className="mt-2 text-sm text-red-400">{checkoutError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          {topupOptionsQuery.isLoading ? (
            <p className="text-sm text-slate-500">Loading top-up options...</p>
          ) : topupOptionsQuery.isError ? (
            <div className="w-full rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
              <p className="text-sm text-amber-400">
                Could not load top-up options.{' '}
                {extractApiError(topupOptionsQuery.error)}
              </p>
              <button
                type="button"
                className="mt-2 rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-700/60 transition-colors"
                onClick={() => void topupOptionsQuery.refetch()}
              >
                Retry
              </button>
            </div>
          ) : (topupOptionsQuery.data?.options ?? []).length > 0 ? (
            (topupOptionsQuery.data?.options ?? []).map((option) => (
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
            ))
          ) : (
            <div className="w-full rounded-md border border-white/5 bg-slate-800/30 p-3">
              <p className="text-sm text-slate-400">
                Wallet top-ups are not yet available on this deployment. Check back soon or contact support.
              </p>
            </div>
          )}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Subscription</h2>
        {subQuery.isLoading ? (
          <p className="mt-2 text-sm text-slate-500">Loading subscription info...</p>
        ) : subQuery.isError ? (
          <div className="mt-2 rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
            <p className="text-sm text-amber-400">
              Could not load subscription info.{' '}
              {extractApiError(subQuery.error)}
            </p>
            <button
              type="button"
              className="mt-2 rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-700/60 transition-colors"
              onClick={() => void subQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : subQuery.data ? (
          <div className="mt-2">
            {subQuery.data.tier === 'free_demo' || (subQuery.data.status !== 'active' && !hasActiveSubscription) ? (
              <div className="rounded-md border border-indigo-700/30 bg-indigo-950/20 p-3">
                <p className="text-sm text-slate-200 font-medium">
                  Free tier
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  You have access to 3 lifetime research runs using General Epistemic Research,
                  available in both Research and Deep Research modes.
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Link
                    to="/pricing"
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 transition-colors"
                  >
                    View plans &amp; upgrade
                  </Link>
                  <Link
                    to="/app/research-v2"
                    className="text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    Start researching
                  </Link>
                </div>
              </div>
            ) : (
              <>
                <p className="text-sm text-slate-400">
                  <span className="font-medium text-slate-200">Tier:</span>{' '}
                  <span className="capitalize">{subQuery.data.tier.replace(/_/g, ' ')}</span>
                  {' · '}
                  <span className="font-medium text-slate-200">Status:</span>{' '}
                  <span className="capitalize">{subQuery.data.status}</span>
                </p>
                {subQuery.data.currentPeriodEnd && stripeSubscriptionGrantsPaidPlan(subQuery.data.status) && (
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
                <div className="mt-3">
                  <Link
                    to="/pricing"
                    className="text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    Compare plans
                  </Link>
                </div>
              </>
            )}
          </div>
        ) : null}

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
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Your add-ons</h2>
          {hasProAccess ? (
            <Link to="/app/monitors" className="text-xs text-indigo-400 hover:text-indigo-300">
              Manage add-ons →
            </Link>
          ) : (
            <Link to="/pricing" className="text-xs text-indigo-400 hover:text-indigo-300">
              Browse add-ons →
            </Link>
          )}
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Per-report subscriptions for Living Reports and Reverse-Citation Watch.
        </p>
        {!hasProAccess ? (
          <div className="mt-3 rounded-md border border-white/5 bg-slate-800/30 p-3">
            <p className="text-sm text-slate-400">
              Add-ons require an active Pro, BYOK, Team, or Sovereign subscription.{' '}
              <Link to="/pricing" className="text-indigo-400 hover:text-indigo-300">
                Upgrade to unlock add-ons.
              </Link>
            </p>
          </div>
        ) : monitorsQuery.isLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading add-ons...</p>
        ) : (() => {
          const active = (monitorsQuery.data?.monitors ?? []).filter((m) => m.status === 'active' || m.status === 'paused');
          if (active.length === 0) {
            return (
              <p className="mt-3 text-sm text-slate-400">
                No add-ons yet. Open any finalized report to add Living Reports or Reverse-Citation Watch.
              </p>
            );
          }
          return (
            <ul className="mt-3 space-y-2 text-sm text-slate-300">
              {active.map((m) => (
                <li key={m.id} className="flex items-center justify-between py-1 border-b border-white/5 last:border-0">
                  <div className="flex-1 min-w-0">
                    <Link to={`/app/reports/${m.report_id}`} className="text-slate-200 hover:text-white">
                      {ADDON_KIND_LABEL[m.monitor_kind]}
                    </Link>
                    <span className="ml-2 text-xs text-slate-500 capitalize">{m.status}</span>
                  </div>
                  <span className="text-xs text-slate-500">{ADDON_PRICE_LABEL[m.monitor_kind]}</span>
                </li>
              ))}
            </ul>
          );
        })()}
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
