/**
 * How a scheduled plan change is worded. A change asked for on the billing
 * page starts with the next billing period, so every sentence about it names
 * the date and says that nothing is charged today.
 */
import { PLAN_LABEL, type PlanIntent } from './planIntent';

export type PlanChangePeriod = 'monthly' | 'annual';

/** A plan change the server has scheduled for the end of the billing period. */
export type ScheduledPlanChange = {
  tier: PlanIntent;
  /** Null when the server could not tell which billing period the price is. */
  billingPeriod: PlanChangePeriod | null;
  /** When the current billing period ends and the new plan starts (ISO 8601). */
  effectiveAt: string;
};

/** The date a plan change starts, as the customer reads it. Null when there is no usable date. */
export function formatPlanChangeDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

/** "BYOK (annual billing)": the plan as it is named in these sentences. */
export function planChangeLabel(tier: PlanIntent, period: PlanChangePeriod | null): string {
  return period ? `${PLAN_LABEL[tier]} (${period} billing)` : PLAN_LABEL[tier];
}

/** The one sentence shown when a change is confirmed and for as long as it is pending. */
export function scheduledChangeSentence(change: ScheduledPlanChange): string {
  const on = formatPlanChangeDate(change.effectiveAt);
  return `Your plan changes to ${planChangeLabel(change.tier, change.billingPeriod)} ${
    on ? `on ${on}` : 'at the end of your current billing period'
  }. Nothing is charged today.`;
}
