import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import { startCheckoutRedirect } from '../../lib/billing/checkout';

export type SubscribeTier = 'pro' | 'student';

type SubscriptionOption = {
  tier: string;
  label: string;
  monthlyPriceId: string;
  annualPriceId: string;
};

type SubscribeCTAProps = {
  tier: SubscribeTier;
  cta: string;
  className?: string;
  featured?: boolean;
  /** Public pricing SSR: sign-up links only (no Clerk provider required). */
  marketingStatic?: boolean;
};

function SubscribeCTAMarketing({
  tier,
  cta,
  className,
}: Pick<SubscribeCTAProps, 'tier' | 'cta' | 'className'>) {
  const ctaClass =
    className ??
    'mt-5 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep';
  return (
    <Link to={`/sign-up?tier=${tier}`} className={ctaClass}>
      {cta}
    </Link>
  );
}

function SubscribeCTAAuthenticated({
  tier,
  cta,
  className,
  featured = false,
}: Omit<SubscribeCTAProps, 'marketingStatic'>) {
  const { isLoaded, isSignedIn } = useAuth();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const optionsQuery = useQuery({
    queryKey: ['billing-subscription-options'],
    queryFn: async () => (await api.get<{ options: SubscriptionOption[] }>('/billing/subscription-options')).data,
    enabled: Boolean(isLoaded && isSignedIn),
    staleTime: 60_000,
  });

  const ctaClass =
    className ??
    `mt-5 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep disabled:opacity-50`;

  if (!isLoaded || !isSignedIn) {
    return (
      <Link to={`/sign-up?tier=${tier}`} className={ctaClass}>
        {cta}
      </Link>
    );
  }

  const option = (optionsQuery.data?.options ?? []).find((o) => o.tier === tier);

  return (
    <div>
      <button
        type="button"
        className={ctaClass}
        disabled={busy || optionsQuery.isLoading || !option?.monthlyPriceId}
        onClick={() => {
          if (!option?.monthlyPriceId) return;
          setCheckoutError(null);
          setBusy(true);
          void startCheckoutRedirect('/billing/checkout/subscription', {
            priceId: option.monthlyPriceId,
            tier: option.tier,
          })
            .catch((e) => setCheckoutError(e instanceof Error ? e.message : 'Checkout failed'))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Redirecting…' : cta}
      </button>
      {checkoutError ? <p className="mt-2 text-xs text-red-400">{checkoutError}</p> : null}
      {featured && !option?.monthlyPriceId && !optionsQuery.isLoading ? (
        <p className="mt-2 text-xs text-r1-text-muted">Subscription checkout is unavailable on this deployment.</p>
      ) : null}
    </div>
  );
}

export default function SubscribeCTA({
  tier,
  cta,
  className,
  featured = false,
  marketingStatic = false,
}: SubscribeCTAProps) {
  if (marketingStatic) {
    return <SubscribeCTAMarketing tier={tier} cta={cta} className={className} />;
  }

  return (
    <SubscribeCTAAuthenticated
      tier={tier}
      cta={cta}
      className={className}
      featured={featured}
    />
  );
}
