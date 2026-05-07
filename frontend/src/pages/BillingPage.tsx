import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../utils/api';
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

export default function BillingPage() {
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

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

  const balance = useMemo(() => ((walletQuery.data?.balanceCents ?? 0) / 100).toFixed(2), [walletQuery.data]);

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
              className="rounded bg-indigo-600 px-3 py-2 text-sm"
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
          <p className="mt-2 text-sm text-slate-400">
            Tier: {subQuery.data.tier} · Status: {subQuery.data.status}
            {subQuery.data.cancelAtPeriodEnd ? ' · Cancels at period end' : ''}
          </p>
        )}
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Recent transactions</h2>
        <ul className="mt-3 space-y-2 text-sm text-slate-300">
          {(walletQuery.data?.history ?? []).map((row) => (
            <li key={row.id} className="flex items-center justify-between">
              <span>{row.description}</span>
              <span>
                {row.entry_type === 'credit' ? '+' : '-'}${(row.amount_cents / 100).toFixed(2)}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
