import NotYetAvailable from './NotYetAvailable';
import { PLAN_LABEL } from '../../lib/billing/planIntent';
import { customerOption, customerOptionHelp } from '../../content/customerOptions';

export type SubscriptionOption = {
  tier: string;
  label: string;
  monthlyPriceId: string;
  annualPriceId: string;
  monthlyAmountCents: number;
  annualAmountCents: number;
};

/** Plans a signed-in user can start from the billing page, with the prices shown on the pricing page. */
const SELF_SERVE_PLANS: ReadonlyArray<{
  tier: 'pro' | 'byok';
  label: string;
  monthlyAmountCents: number;
  annualAmountCents: number;
  summary: string;
}> = [
  {
    tier: 'pro',
    label: PLAN_LABEL.pro,
    monthlyAmountCents: 2900,
    annualAmountCents: 29000,
    summary: '25 reports a month, all 5 modes, private corpus.',
  },
  {
    tier: 'byok',
    label: PLAN_LABEL.byok,
    monthlyAmountCents: 2900,
    annualAmountCents: 29000,
    summary: 'Bring your own model keys. You add them right after checkout.',
  },
];

type PlanCheckoutOptionsProps = {
  options: SubscriptionOption[];
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  onCheckout: (priceId: string, tier: string) => void;
  /** Plan the visitor chose on the pricing page (`?intent=`); drawn first and outlined. */
  highlightTier?: string | null;
};

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

/**
 * The "choose a plan" block of the billing page.
 *
 * Every plan is always drawn. A plan whose Stripe price is not set on the
 * server shows "Not yet available" where its buttons would be. Before this,
 * the whole block was skipped when the server returned no options, so a
 * deployment missing the Pro price showed a subscription section with nothing
 * to press.
 */
export default function PlanCheckoutOptions({
  options,
  isLoading,
  errorMessage,
  onRetry,
  onCheckout,
  highlightTier = null,
}: PlanCheckoutOptionsProps) {
  if (isLoading) {
    return <p className="mt-4 text-sm text-slate-500">Loading plans…</p>;
  }

  if (errorMessage) {
    return (
      <div className="mt-4 rounded-md border border-amber-700/30 bg-amber-950/20 p-3">
        <p className="text-sm text-amber-400">Could not load plans. {errorMessage}</p>
        <button
          type="button"
          className="mt-2 rounded bg-amber-700/40 px-3 py-1 text-xs text-amber-200 hover:bg-amber-700/60 transition-colors"
          onClick={onRetry}
        >
          Retry
        </button>
      </div>
    );
  }

  const plans = [...SELF_SERVE_PLANS].sort(
    (a, b) => Number(b.tier === highlightTier) - Number(a.tier === highlightTier),
  );

  return (
    <div className="mt-4">
      <p className="text-sm text-slate-400 mb-3">Upgrade to a subscription plan:</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {plans.map((plan) => {
          const option = options.find((o) => o.tier === plan.tier);
          const monthlyPriceId = option?.monthlyPriceId ?? '';
          const annualPriceId = option?.annualPriceId ?? '';
          const purchasable = Boolean(monthlyPriceId || annualPriceId);
          return (
            <div
              key={plan.tier}
              data-plan={plan.tier}
              className={`rounded-lg border bg-slate-800/50 p-4 ${
                plan.tier === highlightTier ? 'border-indigo-500/60' : 'border-white/10'
              }`}
            >
              <h3 className="font-medium">{plan.label}</h3>
              <p className="text-sm text-slate-400 mt-1">
                {dollars(option?.monthlyAmountCents ?? plan.monthlyAmountCents)}/mo or{' '}
                {dollars(option?.annualAmountCents ?? plan.annualAmountCents)}/yr
              </p>
              <p className="mt-1 text-xs text-slate-500">{plan.summary}</p>
              <p className="mt-1 text-xs text-slate-500" data-plan-help={plan.tier}>
                {customerOptionHelp(customerOption('plan', plan.tier))}
              </p>
              {purchasable ? (
                <>
                  <div className="mt-3 flex gap-2">
                  {monthlyPriceId ? (
                    <button
                      type="button"
                      className="rounded bg-indigo-600 px-3 py-1.5 text-sm hover:bg-indigo-500 transition-colors"
                      onClick={() => onCheckout(monthlyPriceId, plan.tier)}
                    >
                      Monthly
                    </button>
                  ) : null}
                  {annualPriceId ? (
                    <button
                      type="button"
                      className="rounded bg-emerald-600 px-3 py-1.5 text-sm hover:bg-emerald-500 transition-colors"
                      onClick={() => onCheckout(annualPriceId, plan.tier)}
                    >
                      Annual (save 17%)
                    </button>
                  ) : null}
                  </div>
                  {/* Both prices are quoted above, so a period without one says so. */}
                  {!monthlyPriceId ? <NotYetAvailable className="mt-2" subject="Monthly billing" /> : null}
                  {!annualPriceId ? <NotYetAvailable className="mt-2" subject="Annual billing" /> : null}
                </>
              ) : (
                <NotYetAvailable className="mt-3" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
