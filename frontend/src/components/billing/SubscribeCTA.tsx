import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '@clerk/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import api from '../../utils/api';
import { startCheckoutRedirect } from '../../lib/billing/checkout';
import StudentVerificationPanel from './StudentVerificationPanel';
import NotYetAvailable from './NotYetAvailable';

export type SubscribeTier = 'pro' | 'student' | 'byok';

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
  /**
   * With `marketingStatic`: the visitor already has a session, so the link
   * skips sign-up and goes to billing, where checkout for this plan starts.
   */
  signedIn?: boolean;
};

function SubscribeCTAMarketing({
  tier,
  cta,
  className,
  signedIn = false,
}: Pick<SubscribeCTAProps, 'tier' | 'cta' | 'className' | 'signedIn'>) {
  const ctaClass =
    className ??
    'mt-5 inline-flex rounded-md bg-r1-accent px-3 py-2 text-sm font-semibold text-r1-bg transition hover:bg-r1-accent-deep';
  return (
    <Link to={signedIn ? `/app/billing?intent=${tier}` : `/sign-up?tier=${tier}`} className={ctaClass}>
      {cta}
    </Link>
  );
}

function SubscribeCTAAuthenticated({
  tier,
  cta,
  className,
}: Omit<SubscribeCTAProps, 'marketingStatic' | 'signedIn' | 'featured'>) {
  const { isLoaded, isSignedIn } = useAuth();
  const queryClient = useQueryClient();
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const optionsQuery = useQuery({
    queryKey: ['billing-subscription-options'],
    queryFn: async () => (await api.get<{ options: SubscriptionOption[] }>('/billing/subscription-options')).data,
    enabled: Boolean(isLoaded && isSignedIn),
    staleTime: 60_000,
  });

  const studentStatusQuery = useQuery({
    queryKey: ['billing-student-status'],
    queryFn: async () =>
      (await api.get<{ verified: boolean; programIdConfigured: boolean }>('/billing/student/status')).data,
    enabled: Boolean(isLoaded && isSignedIn && tier === 'student'),
    staleTime: 30_000,
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
  // Monthly when it exists; a plan sold only annually is still purchasable.
  const priceId = option?.monthlyPriceId || option?.annualPriceId || '';
  const studentVerified = tier !== 'student' || Boolean(studentStatusQuery.data?.verified);
  const studentGateLoading = tier === 'student' && studentStatusQuery.isLoading;

  return (
    <div>
      {tier === 'student' ? (
        <StudentVerificationPanel
          compact
          onVerified={() => {
            void queryClient.invalidateQueries({ queryKey: ['billing-student-status'] });
          }}
        />
      ) : null}
      <button
        type="button"
        className={ctaClass}
        disabled={busy || optionsQuery.isLoading || studentGateLoading || !priceId || !studentVerified}
        onClick={() => {
          if (!option || !priceId || !studentVerified) return;
          setCheckoutError(null);
          setBusy(true);
          void startCheckoutRedirect('/billing/checkout/subscription', {
            priceId,
            tier: option.tier,
          })
            .catch((e) => setCheckoutError(e instanceof Error ? e.message : 'Checkout failed'))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? 'Redirecting…' : studentGateLoading ? 'Checking verification…' : cta}
      </button>
      {tier === 'student' && !studentVerified && !studentGateLoading ? (
        <p className="mt-2 text-xs text-r1-text-muted">Complete student verification above to subscribe.</p>
      ) : null}
      {checkoutError ? <p className="mt-2 text-xs text-red-400">{checkoutError}</p> : null}
      {!priceId && !optionsQuery.isLoading ? <NotYetAvailable tone="marketing" className="mt-2" /> : null}
    </div>
  );
}

export default function SubscribeCTA({
  tier,
  cta,
  className,
  marketingStatic = false,
  signedIn = false,
}: SubscribeCTAProps) {
  if (marketingStatic) {
    return <SubscribeCTAMarketing tier={tier} cta={cta} className={className} signedIn={signedIn} />;
  }

  return (
    <SubscribeCTAAuthenticated
      tier={tier}
      cta={cta}
      className={className}
    />
  );
}
