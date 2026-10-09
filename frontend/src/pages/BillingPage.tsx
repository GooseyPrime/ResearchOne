import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import api, {
  extractApiError,
  listUserMonitors,
  getMonitorTokenBalance,
  listMonitorTokenPackages,
  updateMonitorTokenPreferences,
  MONITOR_TOKENS_QUERY_KEY,
  type ReportMonitorRow,
} from '../utils/api';
import PlanCheckoutOptions, { type SubscriptionOption } from '../components/billing/PlanCheckoutOptions';
import PlanSwitchOptions, { type PendingPlanSwitch } from '../components/billing/PlanSwitchOptions';
import type { ScheduledPlanChange } from '../lib/billing/planChange';
import MonitorTokenPurchaseOptions, {
  type AddonEligibilityState,
} from '../components/billing/MonitorTokenPurchaseOptions';
import { TOKEN_PACKS } from '../lib/billing/availability';
import { PLAN_LABEL, isSwitchablePlan, resolvePlanIntentNotice } from '../lib/billing/planIntent';
import { startMonitorTokenCheckoutRedirect } from '../lib/billing/checkout';
import { parseStripeCheckoutReturnSessionId, startCheckoutRedirect } from '../lib/billing/checkout';
import { stripeSubscriptionGrantsPaidPlan } from '../utils/stripeSubscriptionAccess';
import {
  BILLING_SUBSCRIPTION_QUERY_KEY,
  effectiveEntitlementTier,
  useBillingSubscriptionQuery,
  type BillingSubscription,
} from '../hooks/useBillingSubscription';
import { useHasProAccess } from '../hooks/useHasProAccess';
import { BILLING_HISTORY_QUERY_KEY, useBillingHistory } from '../hooks/useBillingHistory';
import { customerOption } from '../content/customerOptions';

const ADDON_PRICE_LABEL: Record<ReportMonitorRow['monitor_kind'], string> = {
  living_report: 'Living Report — token (2 mo / report)',
  reverse_citation_watch: 'Reverse-Citation Watch — $15/mo',
};

const ADDON_KIND_LABEL: Record<ReportMonitorRow['monitor_kind'], string> = {
  living_report: customerOption('add_on', 'living_report').name,
  reverse_citation_watch: customerOption('add_on', 'reverse_citation_watch').name,
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

type TopupOption = {
  priceId: string;
  amountCents: number;
  label: string;
};

/** `/billing/checkout/confirm` adds what the confirmed session bought. */
type ConfirmedBillingSubscription = BillingSubscription & {
  confirmedCheckout?: { kind: 'plan' | 'addon' | 'monitor_tokens' | 'topup'; tier: string | null };
};

const BILLING_PENDING_CHANGE_QUERY_KEY = ['billing-pending-plan-change'] as const;

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
  const [confirming, setConfirming] = useState<'idle' | 'in_progress' | 'error'>('idle');
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [legacyCheckoutWarning, setLegacyCheckoutWarning] = useState(false);
  /** Set only when the checkout just confirmed was a BYOK plan, so that subscriber is pointed at the key step. */
  const [byokJustActivated, setByokJustActivated] = useState(false);
  /** The plan a subscriber has picked in the switch block and not yet confirmed. */
  const [pendingSwitch, setPendingSwitch] = useState<PendingPlanSwitch | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [keepError, setKeepError] = useState<string | null>(null);
  const { hash } = useLocation();

  const billingIntent = searchParams.get('intent');

  // Links elsewhere point at /app/billing#monitor-tokens; the router does not scroll to a hash by itself.
  useEffect(() => {
    if (hash !== '#monitor-tokens') return;
    document.getElementById('monitor-tokens')?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const applyCheckoutConfirmSuccess = useCallback(
    async (data: ConfirmedBillingSubscription) => {
      queryClient.setQueryData(BILLING_SUBSCRIPTION_QUERY_KEY, data);
      await queryClient.invalidateQueries({ queryKey: ['billing-wallet'] }, { cancelRefetch: false });
      await queryClient.invalidateQueries({ queryKey: BILLING_HISTORY_QUERY_KEY }, { cancelRefetch: false });
      await queryClient.invalidateQueries({ queryKey: ['billing-monitors'] }, { cancelRefetch: false });
      await queryClient.invalidateQueries({ queryKey: MONITOR_TOKENS_QUERY_KEY }, { cancelRefetch: false });
      setConfirming('idle');
      setConfirmError(null);
      // From what the session bought, not from the resulting tier: a BYOK
      // subscriber returning from a top-up or a token pack activated nothing.
      setByokJustActivated(
        data.confirmedCheckout?.kind === 'plan' && data.confirmedCheckout.tier === 'byok',
      );
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      next.delete('session_id');
      setSearchParams(next, { replace: true });
    },
    [queryClient, searchParams, setSearchParams],
  );

  const runCheckoutConfirm = useCallback(
    async (sessionId: string) => {
      setConfirming('in_progress');
      try {
        const { data } = await api.post<ConfirmedBillingSubscription>('/billing/checkout/confirm', { sessionId });
        await applyCheckoutConfirmSuccess(data);
      } catch (e) {
        setConfirming('error');
        setConfirmError(extractApiError(e));
      }
    },
    [applyCheckoutConfirmSuccess],
  );

  useEffect(() => {
    const checkout = searchParams.get('checkout');
    const sessionId = parseStripeCheckoutReturnSessionId(searchParams.get('session_id'));

    if (checkout !== 'success') {
      if (checkout === 'cancel') {
        const next = new URLSearchParams(searchParams);
        next.delete('checkout');
        setSearchParams(next, { replace: true });
      }
      return;
    }

    if (!sessionId) {
      const rawSession = searchParams.get('session_id');
      if (rawSession) {
        setConfirming('error');
        setConfirmError(
          'Checkout returned without a valid session id. Refresh billing after the server update, or open Manage billing in Stripe if you were charged.',
        );
        const next = new URLSearchParams(searchParams);
        next.delete('checkout');
        next.delete('session_id');
        setSearchParams(next, { replace: true });
        return;
      }
      setLegacyCheckoutWarning(true);
      void queryClient.invalidateQueries(
        { queryKey: BILLING_SUBSCRIPTION_QUERY_KEY },
        { cancelRefetch: false },
      );
      void queryClient.invalidateQueries({ queryKey: ['billing-wallet'] }, { cancelRefetch: false });
      const next = new URLSearchParams(searchParams);
      next.delete('checkout');
      setSearchParams(next, { replace: true });
      return;
    }

    void runCheckoutConfirm(sessionId);
  }, [queryClient, runCheckoutConfirm, searchParams, setSearchParams]);

  const historyQuery = useBillingHistory(25);

  const walletQuery = useQuery({
    queryKey: ['billing-wallet'],
    queryFn: async () => (await api.get<WalletResponse>('/billing/wallet')).data,
  });

  const subQuery = useBillingSubscriptionQuery();

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
      void queryClient.invalidateQueries(
        { queryKey: BILLING_SUBSCRIPTION_QUERY_KEY },
        { cancelRefetch: false },
      );
      // Cancelling drops a scheduled plan change with it.
      void queryClient.invalidateQueries({ queryKey: BILLING_PENDING_CHANGE_QUERY_KEY }, { cancelRefetch: false });
      setCancelError(null);
    },
    onError: (err: unknown) => {
      setCancelError(extractApiError(err));
    },
  });

  // The server schedules the change for the end of the billing period and
  // returns it. Nothing changes today, so there is nothing to wait for: the
  // scheduled change is shown straight from the answer.
  const switchMutation = useMutation({
    mutationFn: async (choice: PendingPlanSwitch) =>
      (
        await api.post<{ scheduled: boolean; pendingChange: ScheduledPlanChange }>('/billing/subscription/switch', {
          priceId: choice.priceId,
        })
      ).data,
    onSuccess: (data) => {
      setSwitchError(null);
      setKeepError(null);
      setPendingSwitch(null);
      queryClient.setQueryData(BILLING_PENDING_CHANGE_QUERY_KEY, { pendingChange: data.pendingChange });
    },
    onError: (err: unknown) => {
      setSwitchError(extractApiError(err));
      void queryClient.invalidateQueries({ queryKey: BILLING_PENDING_CHANGE_QUERY_KEY }, { cancelRefetch: false });
    },
  });

  // "Keep my current plan": the scheduled change is dropped on the server.
  const keepPlanMutation = useMutation({
    mutationFn: async () => {
      await api.delete('/billing/subscription/pending-change');
    },
    onSuccess: () => {
      setKeepError(null);
      queryClient.setQueryData(BILLING_PENDING_CHANGE_QUERY_KEY, { pendingChange: null });
    },
    onError: (err: unknown) => {
      setKeepError(extractApiError(err));
      void queryClient.invalidateQueries({ queryKey: BILLING_PENDING_CHANGE_QUERY_KEY }, { cancelRefetch: false });
    },
  });

  const balance = useMemo(() => ((walletQuery.data?.balanceCents ?? 0) / 100).toFixed(2), [walletQuery.data]);

  const subRow = subQuery.data;
  const hasActiveSubscription = Boolean(
    subRow &&
      stripeSubscriptionGrantsPaidPlan(subRow.status) &&
      subRow.stripeSubscriptionId,
  );
  const canCancel = hasActiveSubscription && !subQuery.data?.cancelAtPeriodEnd;
  // Only Pro and BYOK subscriptions can be switched from this page, and not one
  // already set to end or with a payment outstanding (the server refuses both).
  const paidUp = subRow?.status === 'active' || subRow?.status === 'trialing';
  const switchableTier =
    hasActiveSubscription && paidUp && !subRow?.cancelAtPeriodEnd && isSwitchablePlan(subRow?.tier)
      ? subRow.tier
      : null;

  // A change already scheduled for the end of the billing period. Asked for
  // only when there is a subscription that could have one.
  const pendingChangeQuery = useQuery({
    queryKey: BILLING_PENDING_CHANGE_QUERY_KEY,
    queryFn: async () =>
      (await api.get<{ pendingChange: ScheduledPlanChange | null }>('/billing/subscription/pending-change')).data,
    enabled: Boolean(switchableTier),
    retry: false,
  });
  const scheduledChange = switchableTier ? pendingChangeQuery.data?.pendingChange ?? null : null;
  // "No change is pending" is only known once the server has answered. Until
  // then, and if the question failed, the plan buttons are not offered: a
  // second change would be refused, and the way to take the first one back
  // would not be on the page.
  const pendingChangeKnown = pendingChangeQuery.isSuccess;

  const effectiveTier = effectiveEntitlementTier(subQuery.data);
  const { hasProAccess, tierGateUnknown } = useHasProAccess();
  // `hasProAccess` is deliberately permissive while the plan is unresolved, which
  // is right for showing a page and wrong for offering a purchase the server
  // will refuse. Buying needs a resolved answer.
  const addonEligibility: AddonEligibilityState = tierGateUnknown
    ? 'unknown'
    : hasProAccess
      ? 'eligible'
      : 'ineligible';
  const intentNotice = resolvePlanIntentNotice({
    intent: billingIntent,
    hasActiveSubscription,
    effectiveTier,
    subscriptionTier: switchableTier ?? undefined,
    subscriptionResolved: Boolean(subQuery.data),
  });

  const monitorsQuery = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: () => listUserMonitors(),
    retry: false,
    enabled: hasProAccess,
  });

  const monitorTokensQuery = useQuery({
    queryKey: MONITOR_TOKENS_QUERY_KEY,
    queryFn: getMonitorTokenBalance,
    retry: false,
  });

  const monitorPackagesQuery = useQuery({
    queryKey: ['billing-monitor-token-packages'],
    queryFn: listMonitorTokenPackages,
    retry: false,
  });

  const [tokenPrefsError, setTokenPrefsError] = useState<string | null>(null);

  const tokenPrefsMutation = useMutation({
    mutationFn: updateMonitorTokenPreferences,
    onSuccess: (data) => {
      queryClient.setQueryData(MONITOR_TOKENS_QUERY_KEY, data);
      setTokenPrefsError(null);
    },
    onError: (err: unknown) => setTokenPrefsError(extractApiError(err)),
  });

  const configuredTokenPackages = useMemo(() => monitorPackagesQuery.data?.packages ?? [], [monitorPackagesQuery.data?.packages]);
  const defaultAutoTopupPackageId = useMemo(() => {
    const saved = monitorTokensQuery.data?.autoTopupPackageId;
    if (saved && configuredTokenPackages.some((p) => p.id === saved)) return saved;
    return configuredTokenPackages[0]?.id ?? null;
  }, [configuredTokenPackages, monitorTokensQuery.data?.autoTopupPackageId]);
  const autoTopupControlsEnabled = configuredTokenPackages.length > 0;

  return (
    <div className="mx-auto max-w-5xl p-6 text-slate-200">
      <h1 className="text-2xl font-semibold">Billing &amp; usage</h1>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Checkout opens on Stripe, where you can enter a promotion code if you have one for an eligible
        purchase. For subscriptions (plans and report add-ons), Stripe omits payment details when the
        amount due is $0 after discounts.
      </p>
      <p className="mt-2 max-w-2xl text-sm text-slate-400">
        Need profile, security, or research preferences? Go to{' '}
        <Link to="/account" className="text-indigo-400 hover:text-indigo-300">
          Account settings
        </Link>
        .
      </p>

      {intentNotice?.kind === 'continue' ? (
        <p className="mt-4 rounded-md border border-indigo-700/40 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-100">
          {intentNotice.plan === 'byok'
            ? 'Continue your BYOK subscription below — checkout opens on Stripe, then you add your model keys.'
            : 'Continue your Pro subscription below — checkout opens on Stripe.'}
        </p>
      ) : null}
      {intentNotice?.kind === 'already_on_plan' ? (
        <p className="mt-4 rounded-md border border-indigo-700/40 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-100">
          You are already on the {PLAN_LABEL[intentNotice.plan]} plan. Nothing more to buy here.
          {intentNotice.plan === 'byok' ? (
            <>
              {' '}
              <Link to="/app/byok" className="underline hover:text-white">
                Configure model keys
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {intentNotice?.kind === 'switch_below' ? (
        <p className="mt-4 rounded-md border border-indigo-700/40 bg-indigo-950/30 px-4 py-3 text-sm text-indigo-100">
          You have an active {PLAN_LABEL[intentNotice.currentTier]} subscription. To move to{' '}
          {PLAN_LABEL[intentNotice.plan]}, use{' '}
          <a href="#switch-plan" className="underline hover:text-white">
            Switch plan
          </a>{' '}
          below. Your subscription is changed, not doubled, and the change starts with your next billing period.
        </p>
      ) : null}
      {intentNotice?.kind === 'switch_not_available' ? (
        <div className="mt-4 rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          <p>
            You have an active{' '}
            <span className="capitalize">{intentNotice.currentTier.replace(/_/g, ' ')}</span> subscription.
            Switching to {PLAN_LABEL[intentNotice.plan]} from this page: not yet available.
          </p>
          <p className="mt-1 text-amber-100/80">
            To change plans, write to{' '}
            <a
              href={`mailto:hello@researchone.io?subject=${encodeURIComponent(`Switch plan to ${PLAN_LABEL[intentNotice.plan]}`)}`}
              className="underline hover:text-white"
            >
              hello@researchone.io
            </a>{' '}
            and we will move your subscription without charging you twice.
          </p>
        </div>
      ) : null}
      {byokJustActivated && effectiveTier === 'byok' ? (
        <div className="mt-4 rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100">
          <p className="font-medium">Your BYOK plan is active.</p>
          <p className="mt-1 text-emerald-100/80">One step left: add the model keys your research runs will use.</p>
          <Link
            to="/app/byok"
            className="mt-3 inline-flex rounded bg-emerald-600 px-3 py-1.5 text-sm text-white hover:bg-emerald-500 transition-colors"
          >
            Configure keys
          </Link>
        </div>
      ) : null}
      {billingIntent === 'student' ? (
        <p className="mt-4 rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100">
          Student subscriptions are coming soon. Available plans are shown below.
        </p>
      ) : null}

      {confirming === 'in_progress' ? (
        <p className="mt-4 rounded-md border border-indigo-700/30 bg-indigo-950/20 px-4 py-3 text-sm text-indigo-200">
          Finalizing your subscription…
        </p>
      ) : null}
      {confirming === 'error' && confirmError ? (
        <div className="mt-4 rounded-md border border-red-700/40 bg-red-950/20 px-4 py-3 text-sm text-red-300">
          <p>{confirmError}</p>
          <button
            type="button"
            className="mt-2 rounded bg-red-800/40 px-3 py-1 text-xs hover:bg-red-800/60"
            onClick={() => {
              const sessionId = parseStripeCheckoutReturnSessionId(searchParams.get('session_id'));
              if (!sessionId) return;
              void runCheckoutConfirm(sessionId);
            }}
          >
            Retry confirmation
          </button>
        </div>
      ) : null}
      {legacyCheckoutWarning ? (
        <p className="mt-4 rounded-md border border-amber-700/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200">
          Checkout succeeded, but this return URL did not include a session id. Refresh in a minute or open Billing &amp; usage
          again if your plan has not updated.
        </p>
      ) : null}

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
            {effectiveTier === 'free_demo' && !hasActiveSubscription ? (
              <div className="rounded-md border border-indigo-700/30 bg-indigo-950/20 p-3">
                <p className="text-sm text-slate-200 font-medium">
                  Free tier
                </p>
                <p className="mt-1 text-sm text-slate-400">
                  {typeof subQuery.data.lifetimeReportCap === 'number' ? (
                    <>
                      You have{' '}
                      <span className="text-slate-200 font-medium">
                        {Math.max(0, subQuery.data.lifetimeReportCap - (subQuery.data.lifetimeReportsUsed ?? 0))}
                      </span>{' '}
                      of {subQuery.data.lifetimeReportCap} lifetime research runs remaining, using the General Research objective.
                    </>
                  ) : (
                    <>
                      You have access to a limited number of lifetime research runs, using the General
                      Research objective.
                    </>
                  )}
                </p>
                <div className="mt-3 flex items-center gap-3">
                  <Link
                    to="/pricing"
                    className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 transition-colors"
                  >
                    View plans &amp; upgrade
                  </Link>
                  <Link
                    to="/app/research"
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
                  <span className="capitalize">{(effectiveTier ?? subQuery.data.tier).replace(/_/g, ' ')}</span>
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
                {hasActiveSubscription ? (
                  <button
                    type="button"
                    className="mt-3 rounded border border-white/20 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 transition-colors"
                    onClick={() => {
                      void api.post<{ url: string }>('/billing/portal-session', {}).then(({ data }) => {
                        if (data.url) window.location.assign(data.url);
                      });
                    }}
                  >
                    Manage billing in Stripe
                  </button>
                ) : null}
                <div className="mt-3 flex flex-wrap items-center gap-4">
                  <Link
                    to="/pricing"
                    className="text-sm text-indigo-400 hover:text-indigo-300"
                  >
                    Compare plans
                  </Link>
                  {effectiveTier === 'byok' ? (
                    <Link to="/app/byok" className="text-sm text-indigo-400 hover:text-indigo-300">
                      Configure model keys
                    </Link>
                  ) : null}
                </div>
              </>
            )}
          </div>
        ) : null}

        {switchableTier ? (
          <PlanSwitchOptions
            currentTier={switchableTier}
            options={subscriptionOptionsQuery.data?.options ?? []}
            isLoading={subscriptionOptionsQuery.isLoading || (!pendingChangeKnown && !pendingChangeQuery.isError)}
            errorMessage={
              subscriptionOptionsQuery.isError
                ? extractApiError(subscriptionOptionsQuery.error)
                : pendingChangeQuery.isError
                  ? extractApiError(pendingChangeQuery.error)
                  : null
            }
            onRetry={() => {
              if (subscriptionOptionsQuery.isError) void subscriptionOptionsQuery.refetch();
              if (pendingChangeQuery.isError) void pendingChangeQuery.refetch();
            }}
            pending={pendingSwitch}
            onSelect={(choice) => {
              setSwitchError(null);
              setPendingSwitch(choice);
            }}
            onConfirm={() => {
              if (pendingSwitch) switchMutation.mutate(pendingSwitch);
            }}
            onCancel={() => {
              setSwitchError(null);
              setPendingSwitch(null);
            }}
            isSwitching={switchMutation.isPending}
            switchError={switchError}
            currentPeriodEnd={subRow?.currentPeriodEnd ?? null}
            scheduled={scheduledChange}
            onKeepCurrentPlan={() => keepPlanMutation.mutate()}
            isKeeping={keepPlanMutation.isPending}
            keepError={keepError}
          />
        ) : null}

        {!hasActiveSubscription ? (
          <PlanCheckoutOptions
            options={subscriptionOptionsQuery.data?.options ?? []}
            isLoading={subscriptionOptionsQuery.isLoading}
            errorMessage={subscriptionOptionsQuery.isError ? extractApiError(subscriptionOptionsQuery.error) : null}
            onRetry={() => void subscriptionOptionsQuery.refetch()}
            highlightTier={billingIntent}
            onCheckout={(priceId, tier) => {
              setCheckoutError(null);
              void startCheckoutRedirect('/billing/checkout/subscription', { priceId, tier }).catch((e) =>
                setCheckoutError(e instanceof Error ? e.message : 'Checkout failed'),
              );
            }}
          />
        ) : null}
      </section>

      <section id="monitor-tokens" className="mt-6 scroll-mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h2 className="text-lg font-medium">Living Report tokens</h2>
        <p className="mt-1 text-xs text-slate-500">
          One token activates monitoring on a single finalized report for 2 months. Separate from API
          wallet credits.
        </p>
        {monitorTokensQuery.isLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading token balance…</p>
        ) : monitorTokensQuery.isError ? (
          <p className="mt-3 text-sm text-amber-400">{extractApiError(monitorTokensQuery.error)}</p>
        ) : (
          <p className="mt-3 text-sm text-slate-300">
            Balance:{' '}
            <span className="font-medium text-slate-100">
              {monitorTokensQuery.data?.tokenBalance ?? 0} token
              {(monitorTokensQuery.data?.tokenBalance ?? 0) === 1 ? '' : 's'}
            </span>
          </p>
        )}
        {checkoutError ? <p className="mt-2 text-sm text-red-400">{checkoutError}</p> : null}
        <div className="mt-4 flex flex-wrap gap-2">
          <MonitorTokenPurchaseOptions
            packages={monitorPackagesQuery.data?.packages ?? []}
            advertised={TOKEN_PACKS}
            isLoading={monitorPackagesQuery.isLoading || subQuery.isLoading}
            errorMessage={monitorPackagesQuery.isError ? extractApiError(monitorPackagesQuery.error) : null}
            onRetry={() => void monitorPackagesQuery.refetch()}
            eligibility={addonEligibility}
            onRetryEligibility={() => void subQuery.refetch()}
            onBuy={(packageId) => {
              setCheckoutError(null);
              void startMonitorTokenCheckoutRedirect(packageId).catch((e) =>
                setCheckoutError(e instanceof Error ? e.message : 'Checkout failed'),
              );
            }}
          />
        </div>
        <div className="mt-4 space-y-2 border-t border-white/5 pt-4">
          <label className="flex items-center gap-2 text-sm text-slate-300">
            <input
              type="checkbox"
              checked={Boolean(monitorTokensQuery.data?.autoTopupEnabled)}
              disabled={
                !autoTopupControlsEnabled ||
                tokenPrefsMutation.isPending ||
                monitorTokensQuery.isLoading
              }
              onChange={(e) => {
                if (!defaultAutoTopupPackageId) return;
                tokenPrefsMutation.mutate({
                  autoTopupEnabled: e.target.checked,
                  autoTopupPackageId: defaultAutoTopupPackageId,
                });
              }}
            />
            Auto top-up when balance hits zero
          </label>
          <p className="text-xs text-slate-500">
            Preference only — automatic Stripe charges when depleted are not enabled yet; you will be
            notified to buy tokens manually.
          </p>
          {monitorTokensQuery.data?.autoTopupEnabled ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-slate-500">Package when topping up:</span>
              <select
                className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-xs text-slate-200"
                value={defaultAutoTopupPackageId ?? ''}
                disabled={tokenPrefsMutation.isPending || !defaultAutoTopupPackageId}
                onChange={(e) =>
                  tokenPrefsMutation.mutate({
                    autoTopupEnabled: true,
                    autoTopupPackageId: e.target.value,
                  })
                }
              >
                {configuredTokenPackages.map((pkg) => (
                  <option key={pkg.id} value={pkg.id}>
                    {pkg.label}
                  </option>
                ))}
              </select>
            </div>
          ) : null}
          {tokenPrefsError ? <p className="text-xs text-red-400">{tokenPrefsError}</p> : null}
        </div>
      </section>

      <section className="mt-6 rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-medium">Your add-ons</h2>
          <Link to="/app/add-ons" className="text-xs text-indigo-400 hover:text-indigo-300">
            {hasProAccess ? 'Manage add-ons →' : 'Browse add-ons →'}
          </Link>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Living Reports use tokens per report; Reverse-Citation Watch remains a Stripe subscription.
        </p>
        {!hasProAccess ? (
          <div className="mt-3 rounded-md border border-white/5 bg-slate-800/30 p-3">
            <p className="text-sm text-slate-400">
              Add-ons require an active Pro or BYOK subscription.{' '}
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
                No add-ons yet. Open the add-ons catalog to subscribe on a finalized report.
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
        <h2 className="text-lg font-medium">Billing history</h2>
        <p className="mt-1 text-xs text-slate-500">
          Subscription invoices and wallet credits in one timeline.
        </p>
        {historyQuery.isLoading ? (
          <p className="mt-3 text-sm text-slate-500">Loading billing history…</p>
        ) : historyQuery.isError ? (
          <div className="mt-3 rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
            <p className="text-sm text-amber-400">
              Could not load billing history. {extractApiError(historyQuery.error)}
            </p>
            <button
              type="button"
              className="mt-2 rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-700/60 transition-colors"
              onClick={() => void historyQuery.refetch()}
            >
              Retry
            </button>
          </div>
        ) : (historyQuery.data?.items ?? []).length === 0 ? (
          <p className="mt-3 text-sm text-slate-500">No billing events yet</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm text-slate-300">
            {(historyQuery.data?.items ?? []).map((row) => {
              const amount =
                row.amount_cents != null
                  ? `${row.status === 'credit' || row.status === 'paid' ? '+' : row.status === 'debit' || row.status === 'failed' ? '-' : ''}$${(Math.abs(row.amount_cents) / 100).toFixed(2)}`
                  : null;
              const statusClass =
                row.status === 'paid' || row.status === 'credit'
                  ? 'text-emerald-400'
                  : row.status === 'failed' || row.status === 'debit'
                    ? 'text-red-400'
                    : 'text-slate-400';
              return (
                <li
                  key={`${row.kind}-${row.id}`}
                  className="flex items-center justify-between gap-3 py-1 border-b border-white/5 last:border-0"
                >
                  <div className="flex-1 min-w-0">
                    <span>{row.description}</span>
                    <span className="ml-2 text-xs text-slate-500">{formatTimestamp(row.occurred_at)}</span>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-right">
                    {amount ? <span className={statusClass}>{amount}</span> : null}
                    <span className="rounded-full border border-white/10 px-2 py-0.5 text-xs capitalize text-slate-400">
                      {row.status}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
