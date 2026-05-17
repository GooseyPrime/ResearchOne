import { isTierName } from '../../config/tierRules';
import { logger } from '../../utils/logger';
import { ensureUserAndTierRow } from '../users/ensureUserRow';
import { setUserTier } from '../tier/tierService';
import {
  syncSubscription,
  resolveSubscriptionPlanTier,
} from './subscriptionService';
import { stripeSubscriptionStatusGrantsPlanAccess } from './stripeSubscriptionStatus';
import {
  monitorKindFromStripePriceId,
  registerMonitor,
  subscriptionHasLivingReportsPrice,
} from '../monitoring/parallelMonitorService';
import { recordBillingEvent, type BillingEventKind } from './billingEventsService';
import { resolveUserIdFromStripeIdentity } from './resolveStripeUserId';
import { queryOne } from '../../db/pool';

export type StripeSubscriptionLike = {
  id: string;
  customer: string | { id: string; metadata?: { user_id?: string } };
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata?: {
    user_id?: string;
    userId?: string;
    tier?: string;
    report_id?: string;
    monitor_kind?: string;
  };
  items?: {
    data?: Array<{ id?: string; price?: { id?: string | null; lookup_key?: string | null } }>;
  };
};

export async function resolveUserIdForSubscription(
  subscription: StripeSubscriptionLike,
  clientReferenceId?: string | null
): Promise<string | null> {
  return resolveUserIdFromStripeIdentity({
    metadata: subscription.metadata,
    client_reference_id: clientReferenceId ?? null,
    customer: subscription.customer,
  });
}

export class StripeSubscriptionUserUnresolvedError extends Error {
  constructor(
    public readonly subscriptionId: string,
    public readonly eventId?: string
  ) {
    super(
      `could not resolve user_id from subscription ${subscriptionId}, customer, or stripe_customers table`
    );
    this.name = 'StripeSubscriptionUserUnresolvedError';
  }
}

/**
 * Canonical subscription → local entitlement sync (webhook + confirm endpoint).
 */
export async function syncStripeSubscriptionToUser(args: {
  subscription: StripeSubscriptionLike;
  userId: string;
  eventId?: string;
  source: 'webhook' | 'confirm-endpoint';
  occurredAt?: Date;
}): Promise<void> {
  const { subscription, userId, eventId, source } = args;
  const occurredAt = args.occurredAt ?? new Date();

  await ensureUserAndTierRow(userId, null);

  const items = subscription.items?.data ?? [];
  const isMonitorOnlySubscription =
    stripeSubscriptionStatusGrantsPlanAccess(subscription.status) &&
    subscriptionHasLivingReportsPrice(items);

  if (isMonitorOnlySubscription) {
    const reportId = subscription.metadata?.report_id?.trim();
    const rawKind = subscription.metadata?.monitor_kind?.trim();
    const monitorKind =
      rawKind === 'reverse_citation_watch' || rawKind === 'living_report' ? rawKind : null;
    if (reportId && monitorKind) {
      const priceEntry = items.find(
        (it) => monitorKindFromStripePriceId(it.price?.id ?? '') === monitorKind
      );
      const stripePriceId = priceEntry?.price?.id ?? '';
      const expectedKind = monitorKindFromStripePriceId(stripePriceId);
      if (expectedKind === monitorKind) {
        await registerMonitor({
          reportId,
          userId,
          orgId: null,
          monitorKind,
          stripeSubscriptionId: subscription.id,
          stripeSubscriptionItemId: priceEntry?.id ?? null,
        });
        await recordBillingEvent({
          userId,
          stripeEventId: eventId ?? null,
          stripeSubscriptionId: subscription.id,
          eventKind: 'addon_started',
          addonKind: monitorKind,
          description: `Add-on started · ${monitorKind === 'living_report' ? 'Living Report' : 'Reverse-Citation Watch'}`,
          occurredAt,
        });
      }
    }
    return;
  }

  const monitorKindMeta = subscription.metadata?.monitor_kind?.trim();
  const isAddonSubscriptionMetadata =
    monitorKindMeta === 'reverse_citation_watch' || monitorKindMeta === 'living_report';

  const item = items[0];
  const priceLookupKey = item?.price?.lookup_key ?? null;
  const stripePriceId = item?.price?.id ?? null;
  const metadataTier = subscription.metadata?.tier ?? null;

  const customerId =
    typeof subscription.customer === 'string'
      ? subscription.customer
      : subscription.customer.id;

  const prev = await queryOne<{
    status: string;
    current_period_end: string | null;
    cancel_at_period_end: boolean;
    tier: string;
  }>(
    `SELECT status, current_period_end, cancel_at_period_end, tier
     FROM user_subscriptions WHERE user_id = $1`,
    [userId]
  );

  const resolvedTier = resolveSubscriptionPlanTier({
    priceLookupKey,
    stripePriceId,
    metadataTier,
  });

  await syncSubscription(
    userId,
    customerId,
    subscription.id,
    subscription.status,
    new Date(subscription.current_period_end * 1000),
    subscription.cancel_at_period_end,
    priceLookupKey,
    stripePriceId,
    metadataTier
  );

  if (isAddonSubscriptionMetadata) {
    return;
  }

  const grants = stripeSubscriptionStatusGrantsPlanAccess(subscription.status);
  if (!grants) {
    return;
  }

  if (!isTierName(resolvedTier) || resolvedTier === 'anonymous') {
    return;
  }

  try {
    await setUserTier(userId, resolvedTier);
  } catch (err) {
    logger.warn('stripe_sync_tier_failed', {
      eventId,
      userId,
      source,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }

  const periodEndIso = new Date(subscription.current_period_end * 1000).toISOString();
  let eventKind: BillingEventKind = 'subscription_updated';
  if (!prev) {
    eventKind = 'subscription_started';
  } else if (
    prev.current_period_end &&
    periodEndIso > prev.current_period_end &&
    subscription.status === 'active'
  ) {
    eventKind = 'subscription_renewed';
  } else if (subscription.status === 'canceled') {
    eventKind = 'subscription_canceled';
  }

  await recordBillingEvent({
    userId,
    stripeEventId: eventId ?? null,
    stripeSubscriptionId: subscription.id,
    eventKind,
    tier: resolvedTier,
    description:
      eventKind === 'subscription_started'
        ? `Subscription started · ${resolvedTier}`
        : eventKind === 'subscription_renewed'
          ? `Subscription renewed · ${resolvedTier}`
          : eventKind === 'subscription_canceled'
            ? 'Subscription canceled'
            : `Subscription updated · ${resolvedTier}`,
    occurredAt,
  });
}

/** Stripe SDK subscription shape (structural — avoids version-specific Stripe namespace types). */
export type StripeSubscriptionInput = {
  id: string;
  customer: StripeSubscriptionLike['customer'];
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata?: StripeSubscriptionLike['metadata'];
  items: {
    data: Array<{
      id: string;
      price: string | { id?: string | null; lookup_key?: string | null } | null;
    }>;
  };
};

export function toSubscriptionLike(sub: StripeSubscriptionInput): StripeSubscriptionLike {
  return {
    id: sub.id,
    customer: sub.customer as StripeSubscriptionLike['customer'],
    status: sub.status,
    current_period_end: sub.current_period_end,
    cancel_at_period_end: sub.cancel_at_period_end,
    metadata: sub.metadata as StripeSubscriptionLike['metadata'],
    items: {
      data: sub.items.data.map((item) => ({
        id: item.id,
        price: {
          id: typeof item.price === 'string' ? item.price : item.price?.id ?? null,
          lookup_key:
            typeof item.price === 'string' ? null : item.price?.lookup_key ?? null,
        },
      })),
    },
  };
}
