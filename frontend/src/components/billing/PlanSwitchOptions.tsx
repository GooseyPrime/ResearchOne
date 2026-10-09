import { useEffect, useRef } from 'react';
import NotYetAvailable from './NotYetAvailable';
import type { SubscriptionOption } from './PlanCheckoutOptions';

import type { PlanIntent } from '../../lib/billing/planIntent';
import {
  formatPlanChangeDate,
  planChangeLabel,
  scheduledChangeSentence,
  type ScheduledPlanChange,
} from '../../lib/billing/planChange';

export type SwitchablePlan = PlanIntent;
export type SwitchPeriod = 'monthly' | 'annual';

/** The plan and billing period a subscriber has picked and not yet confirmed. */
export type PendingPlanSwitch = {
  priceId: string;
  tier: SwitchablePlan;
  period: SwitchPeriod;
};

const SWITCHABLE_PLANS: ReadonlyArray<{ tier: SwitchablePlan; label: string; summary: string }> = [
  { tier: 'pro', label: 'Pro', summary: '25 reports a month, all 5 modes, private corpus.' },
  { tier: 'byok', label: 'BYOK', summary: 'Bring your own model keys.' },
];

const PERIOD_LABEL: Record<SwitchPeriod, string> = { monthly: 'monthly', annual: 'annual' };

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

type PlanSwitchOptionsProps = {
  /** The plan the subscriber is on now. */
  currentTier: SwitchablePlan;
  options: SubscriptionOption[];
  isLoading: boolean;
  errorMessage: string | null;
  onRetry: () => void;
  pending: PendingPlanSwitch | null;
  onSelect: (choice: PendingPlanSwitch) => void;
  onConfirm: () => void;
  onCancel: () => void;
  isSwitching: boolean;
  switchError: string | null;
  /** When the billing period the customer has paid for ends (ISO 8601), if known. */
  currentPeriodEnd?: string | null;
  /** The change already scheduled, if any. While there is one, no other can be picked. */
  scheduled?: ScheduledPlanChange | null;
  /** "Keep my current plan": drops the scheduled change. */
  onKeepCurrentPlan?: () => void;
  isKeeping?: boolean;
  keepError?: string | null;
};

/**
 * The "switch plan" block of the billing page, shown to a Pro or BYOK
 * subscriber in place of the "choose a plan" block.
 *
 * Picking a plan does not change anything. It opens a confirmation that says
 * when the plan will change; only "Confirm change" sends the request. The
 * change starts with the next billing period: nothing is charged or credited
 * on the day it is asked for, and the customer keeps one subscription.
 *
 * Once a change is scheduled the block shows it, with "Keep my current plan"
 * to take it back. Only one change can be pending, so the plan buttons are
 * not offered until it has started or been taken back.
 */
export default function PlanSwitchOptions({
  currentTier,
  options,
  isLoading,
  errorMessage,
  onRetry,
  pending,
  onSelect,
  onConfirm,
  onCancel,
  isSwitching,
  switchError,
  currentPeriodEnd = null,
  scheduled = null,
  onKeepCurrentPlan,
  isKeeping = false,
  keepError = null,
}: PlanSwitchOptionsProps) {
  // The confirmation appears below the plan boxes. Focus moves to it so a
  // keyboard or screen-reader user is taken to the question, not left on the
  // button they pressed.
  const confirmRef = useRef<HTMLDivElement>(null);
  const pendingPriceId = pending?.priceId ?? null;
  useEffect(() => {
    if (pendingPriceId) confirmRef.current?.focus();
  }, [pendingPriceId]);

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

  if (scheduled) {
    return (
      <div className="mt-4" id="switch-plan">
        <div
          role="status"
          data-scheduled-plan-change={scheduled.tier}
          className="rounded-md border border-emerald-700/40 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-100"
        >
          <p className="font-medium">{scheduledChangeSentence(scheduled)}</p>
          <p className="mt-1 text-emerald-100/80">
            Until then you stay on your current plan. To choose a different plan, keep your current plan first.
          </p>
          <button
            type="button"
            disabled={isKeeping}
            className="mt-3 rounded border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50"
            onClick={onKeepCurrentPlan}
          >
            {isKeeping ? 'Keeping your current plan…' : 'Keep my current plan'}
          </button>
        </div>
        {keepError ? <p className="mt-2 text-sm text-red-400">{keepError}</p> : null}
      </div>
    );
  }

  const pendingLabel = pending ? planChangeLabel(pending.tier, pending.period) : '';
  const changesOn = formatPlanChangeDate(currentPeriodEnd);
  const when = changesOn ? `on ${changesOn}` : 'at the end of your current billing period';

  return (
    <div className="mt-4" id="switch-plan">
      <p className="text-sm text-slate-400 mb-3">
        Switch plan or billing period. A change starts with your next billing period; nothing is charged today.
      </p>
      <div className="grid gap-3 sm:grid-cols-2">
        {SWITCHABLE_PLANS.map((plan) => {
          const option = options.find((o) => o.tier === plan.tier);
          const prices: Array<{ period: SwitchPeriod; priceId: string; amountCents: number | undefined }> = [
            { period: 'monthly', priceId: option?.monthlyPriceId ?? '', amountCents: option?.monthlyAmountCents },
            { period: 'annual', priceId: option?.annualPriceId ?? '', amountCents: option?.annualAmountCents },
          ];
          const isCurrent = plan.tier === currentTier;
          const anyPrice = prices.some((p) => p.priceId);
          return (
            <div
              key={plan.tier}
              data-switch-plan={plan.tier}
              className={`rounded-lg border bg-slate-800/50 p-4 ${isCurrent ? 'border-indigo-500/60' : 'border-white/10'}`}
            >
              <h3 className="font-medium">
                {option?.label ?? plan.label}
                {isCurrent ? <span className="ml-2 text-xs font-normal text-indigo-300">Your current plan</span> : null}
              </h3>
              <p className="mt-1 text-xs text-slate-500">{plan.summary}</p>
              {anyPrice ? (
                <>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {prices.map((price) =>
                      price.priceId ? (
                        <button
                          key={price.period}
                          type="button"
                          disabled={isSwitching}
                          className="rounded border border-white/20 px-3 py-1.5 text-sm text-slate-200 hover:bg-white/5 transition-colors disabled:opacity-50"
                          onClick={() => onSelect({ priceId: price.priceId, tier: plan.tier, period: price.period })}
                        >
                          {isCurrent ? 'Change to' : 'Switch to'} {PERIOD_LABEL[price.period]}
                          {price.amountCents !== undefined
                            ? ` (${dollars(price.amountCents)}/${price.period === 'monthly' ? 'mo' : 'yr'})`
                            : ''}
                        </button>
                      ) : null,
                    )}
                  </div>
                  {prices.map((price) =>
                    price.priceId ? null : (
                      <NotYetAvailable
                        key={price.period}
                        className="mt-2"
                        subject={price.period === 'monthly' ? 'Monthly billing' : 'Annual billing'}
                      />
                    ),
                  )}
                </>
              ) : (
                <NotYetAvailable className="mt-3" />
              )}
            </div>
          );
        })}
      </div>

      {pending ? (
        <div
          ref={confirmRef}
          tabIndex={-1}
          role="alertdialog"
          aria-labelledby="plan-switch-confirm-title"
          aria-describedby="plan-switch-confirm-detail"
          className="mt-4 rounded-md border border-amber-700/40 bg-amber-950/20 px-4 py-3 text-sm text-amber-100 focus:outline-none focus:ring-2 focus:ring-amber-500/60"
        >
          <p id="plan-switch-confirm-title" className="font-medium">Change to {pendingLabel}?</p>
          <p id="plan-switch-confirm-detail" className="mt-1 text-amber-100/90">
            Your plan changes to {pendingLabel} {when}, when the billing period you have paid for ends. Nothing is
            charged today. You keep one subscription, and you can take the change back any time before then.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={isSwitching}
              className="rounded bg-indigo-600 px-3 py-1.5 text-sm text-white hover:bg-indigo-500 transition-colors disabled:opacity-50"
              onClick={onConfirm}
            >
              {isSwitching ? 'Scheduling…' : 'Confirm change'}
            </button>
            <button
              type="button"
              disabled={isSwitching}
              className="rounded border border-white/20 px-3 py-1.5 text-sm text-slate-300 hover:bg-white/5 transition-colors disabled:opacity-50"
              onClick={onCancel}
            >
              Not now
            </button>
          </div>
        </div>
      ) : null}
      {switchError ? <p className="mt-2 text-sm text-red-400">{switchError}</p> : null}
    </div>
  );
}
