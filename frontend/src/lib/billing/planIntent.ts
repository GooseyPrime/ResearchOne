/**
 * What the billing page says to a visitor who arrived from a plan's Subscribe
 * button (`/app/billing?intent=pro|byok`).
 *
 * A user who already has a subscription is not shown the plan buttons, because
 * starting Checkout again would create a second subscription beside the first.
 * So for them "continue below" would point at nothing; they are told where
 * they stand instead.
 */
export type PlanIntent = 'pro' | 'byok';

export type PlanIntentNotice =
  | { kind: 'continue'; plan: PlanIntent }
  | { kind: 'already_on_plan'; plan: PlanIntent }
  | { kind: 'switch_not_available'; plan: PlanIntent; currentTier: string }
  | null;

export const PLAN_LABEL: Record<PlanIntent, string> = { pro: 'Pro', byok: 'BYOK' };

export function isPlanIntent(value: string | null): value is PlanIntent {
  return value === 'pro' || value === 'byok';
}

export function resolvePlanIntentNotice(args: {
  intent: string | null;
  hasActiveSubscription: boolean;
  effectiveTier: string | undefined;
  /** False until the subscription has been read; nothing is said before then. */
  subscriptionResolved: boolean;
}): PlanIntentNotice {
  const { intent, hasActiveSubscription, effectiveTier, subscriptionResolved } = args;
  if (!isPlanIntent(intent) || !subscriptionResolved) return null;
  if (!hasActiveSubscription) return { kind: 'continue', plan: intent };
  if (effectiveTier === intent) return { kind: 'already_on_plan', plan: intent };
  return { kind: 'switch_not_available', plan: intent, currentTier: effectiveTier ?? 'current' };
}
