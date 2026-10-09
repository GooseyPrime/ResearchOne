/**
 * What the billing page says to a visitor who arrived from a plan's Subscribe
 * button (`/app/billing?intent=pro|byok`).
 *
 * A user who already has a subscription is not shown the checkout buttons,
 * because starting Checkout again would create a second subscription beside
 * the first. A Pro or BYOK subscriber is pointed at the switch block instead,
 * which changes the subscription they have. Subscribers on any other plan
 * cannot switch from the page and are told who to write to.
 */
import { customerOption } from '../../content/customerOptions';

export type PlanIntent = 'pro' | 'byok';

export type PlanIntentNotice =
  | { kind: 'continue'; plan: PlanIntent }
  | { kind: 'already_on_plan'; plan: PlanIntent }
  | { kind: 'switch_below'; plan: PlanIntent; currentTier: PlanIntent }
  | { kind: 'switch_not_available'; plan: PlanIntent; currentTier: string }
  | null;

/** Plan names, from the registry of customer-facing names. */
export const PLAN_LABEL: Record<PlanIntent, string> = {
  pro: customerOption('plan', 'pro').name,
  byok: customerOption('plan', 'byok').name,
};

export function isPlanIntent(value: string | null): value is PlanIntent {
  return value === 'pro' || value === 'byok';
}

/** Plans a subscriber can move between from the billing page. No other plan is among them. */
export function isSwitchablePlan(tier: string | null | undefined): tier is PlanIntent {
  return tier === 'pro' || tier === 'byok';
}

export function resolvePlanIntentNotice(args: {
  intent: string | null;
  hasActiveSubscription: boolean;
  effectiveTier: string | undefined;
  /** Plan of the Stripe subscription itself; decides whether it can be switched from the page. */
  subscriptionTier?: string;
  /** False until the subscription has been read; nothing is said before then. */
  subscriptionResolved: boolean;
}): PlanIntentNotice {
  const { intent, hasActiveSubscription, effectiveTier, subscriptionTier, subscriptionResolved } = args;
  if (!isPlanIntent(intent) || !subscriptionResolved) return null;
  if (!hasActiveSubscription) return { kind: 'continue', plan: intent };
  if (effectiveTier === intent) return { kind: 'already_on_plan', plan: intent };
  if (isSwitchablePlan(subscriptionTier) && subscriptionTier !== intent) {
    return { kind: 'switch_below', plan: intent, currentTier: subscriptionTier };
  }
  return { kind: 'switch_not_available', plan: intent, currentTier: effectiveTier ?? 'current' };
}
