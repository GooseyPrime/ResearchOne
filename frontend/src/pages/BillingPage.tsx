import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthedFetch } from '../lib/api/authedFetch';
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
  const authedFetch = useAuthedFetch();

  const walletQuery = useQuery({
    queryKey: ['billing-wallet'],
    queryFn: async () => {
      const res = await authedFetch('/api/billing/wallet');
      if (!res.ok) throw new Error('Failed to load wallet');
      return (await res.json()) as WalletResponse;
    },
  });

  const subQuery = useQuery({
    queryKey: ['billing-subscription'],
    queryFn: async () => {
      const res = await authedFetch('/api/billing/subscription');
      if (!res.ok) throw new Error('Failed to load subscription');
      return (await res.json()) as SubscriptionResponse;
    },
  });
  const topupOptionsQuery = useQuery({
    queryKey: ['billing-topup-options'],
    queryFn: async () => {
      const res = await authedFetch('/api/billing/topup-options');
      if (!res.ok) throw new Error('Failed to load top-up options');
      return (await res.json()) as { options: TopupOption[] };
    },
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
        <div className="mt-4 flex flex-wrap gap-2">
          {(topupOptionsQuery.data?.options ?? []).map((option) => (
            <button
              key={option.priceId}
              className="rounded bg-indigo-600 px-3 py-2 text-sm"
              onClick={() =>
                startCheckoutRedirect(authedFetch, '/api/billing/checkout/topup', { priceId: option.priceId })
              }
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
