/**
 * Stripe webhook handler with signature verification, idempotency, and transactional ledger writes.
 *
 * Critical reminder from Work Order F:
 * Do NOT log webhook payload contents in plaintext to logs that might be queried by support
 * — they contain Stripe customer details. Log event IDs and event types only; payload is in
 * stripe_webhook_events.payload jsonb for debugging and is RLS-restricted to admin role.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { getStripeClient, getTopupAmountForPrice } from '../../services/billing/stripeClient';
import { creditWallet } from '../../services/billing/walletService';
import {
  syncSubscription,
  markSubscriptionCanceled,
  resolveSubscriptionPlanTier,
} from '../../services/billing/subscriptionService';
import { stripeSubscriptionStatusGrantsPlanAccess } from '../../services/billing/stripeSubscriptionStatus';
import { dispatchWebhookEvent, type WebhookEventHandler } from './_shared/verifyAndDispatch';
import { query } from '../../db/pool';
import { setUserTier } from '../../services/tier/tierService';
import { isTierName, type TierName } from '../../config/tierRules';
import {
  cancelMonitorByStripeSubscription,
  cancelUserAddonSubscriptions,
  monitorKindFromStripePriceId,
  registerMonitor,
  recordSubscriptionPastDueForMonitor,
  subscriptionHasLivingReportsPrice,
} from '../../services/monitoring/parallelMonitorService';
import {
  createUserNotification,
  resolveUserIdFromStripeSubscription,
} from '../../services/notifications/userNotifications';

const router = Router();

type StripeEventData = Record<string, unknown>;

interface CheckoutSessionData {
  id: string;
  metadata?: { userId?: string; user_id?: string; topupAmountCents?: string; price_id?: string };
  amount_total?: number;
}

/**
 * Handler for checkout.session.completed events (wallet top-ups).
 * Credits the user's wallet based on the checkout session metadata.
 *
 * The billing route writes metadata as { userId, topupAmountCents }.
 * We also accept { user_id, price_id } for forward compatibility.
 */
const handleCheckoutSessionCompleted: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const session = data as unknown as CheckoutSessionData;
  const userId = session.metadata?.userId ?? session.metadata?.user_id;
  const topupAmountStr = session.metadata?.topupAmountCents;
  const priceId = session.metadata?.price_id;

  if (!userId) {
    logger.warn('stripe_checkout_missing_metadata', { eventId, sessionId: session.id });
    return;
  }

  let amountCents: number | null = null;
  if (topupAmountStr) {
    amountCents = parseInt(topupAmountStr, 10) || null;
  } else if (priceId) {
    amountCents = getTopupAmountForPrice(priceId);
  }

  if (amountCents === null) {
    logger.warn('stripe_checkout_unknown_amount', { eventId, sessionId: session.id });
    return;
  }

  await creditWallet({
    userId,
    amountCents,
    description: `Wallet top-up via Stripe checkout`,
    idempotencyKey: `stripe_checkout_${session.id}`,
    stripeCheckoutSessionId: session.id,
    metadata: { eventId, priceId },
  });
};

interface SubscriptionData {
  id: string;
  customer: string | { id: string };
  status: string;
  current_period_end: number;
  cancel_at_period_end: boolean;
  metadata?: { user_id?: string; userId?: string; tier?: string; report_id?: string; monitor_kind?: string };
  items?: {
    data?: Array<{ id?: string; price?: { id?: string | null; lookup_key?: string | null } }>;
  };
}

/**
 * Handler for customer.subscription.created and customer.subscription.updated events.
 * Syncs the subscription state to the local database.
 */
const handleSubscriptionCreatedOrUpdated: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const subscription = data as unknown as SubscriptionData;
  const userId = subscription.metadata?.user_id ?? subscription.metadata?.userId;

  if (!userId) {
    logger.warn('stripe_subscription_missing_user_id', { eventId, subscriptionId: subscription.id });
    return;
  }

  const items = subscription.items?.data ?? [];
  const isMonitorOnlySubscription =
    stripeSubscriptionStatusGrantsPlanAccess(subscription.status) && subscriptionHasLivingReportsPrice(items);

  // Monitor-only subscriptions must not corrupt the user's plan tier.
  // Handle them before tier sync and return early after registration.
  if (isMonitorOnlySubscription) {
    const reportId = subscription.metadata?.report_id?.trim();
    const rawKind = subscription.metadata?.monitor_kind?.trim();
    const monitorKind =
      rawKind === 'reverse_citation_watch' || rawKind === 'living_report' ? rawKind : null;
    if (reportId && monitorKind) {
      const priceEntry = items.find((it) => monitorKindFromStripePriceId(it.price?.id ?? '') === monitorKind);
      const stripePriceId = priceEntry?.price?.id ?? '';
      const expectedKind = monitorKindFromStripePriceId(stripePriceId);
      if (expectedKind === monitorKind) {
        try {
          await registerMonitor({
            reportId,
            userId,
            orgId: null,
            monitorKind,
            stripeSubscriptionId: subscription.id,
            stripeSubscriptionItemId: priceEntry?.id ?? null,
          });
        } catch (regErr) {
          logger.error('stripe_living_report_register_failed', {
            eventId,
            subscriptionId: subscription.id,
            error: regErr instanceof Error ? regErr.message : 'Unknown',
          });
          throw regErr;
        }
      }
    }
    return;
  }

  // Normal tier subscription — sync plan state
  const item = subscription.items?.data?.[0];
  const priceLookupKey = item?.price?.lookup_key ?? null;
  const stripePriceId = item?.price?.id ?? null;
  const metadataTier = subscription.metadata?.tier ?? null;

  await syncSubscription(
    userId,
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    subscription.id,
    subscription.status,
    new Date(subscription.current_period_end * 1000),
    subscription.cancel_at_period_end,
    priceLookupKey,
    stripePriceId,
    metadataTier
  );

  // `user_tiers` drives research caps and objective gates — keep it aligned with
  // the same tier resolution as `user_subscriptions` (lookup_key is often absent).
  const resolved = resolveSubscriptionPlanTier({ priceLookupKey, stripePriceId, metadataTier });
  const grants = stripeSubscriptionStatusGrantsPlanAccess(subscription.status);
  let tierToApply: TierName = 'free_demo';
  if (grants) {
    if (isTierName(resolved) && resolved !== 'anonymous') {
      tierToApply = resolved;
    }
  }
  try {
    await setUserTier(userId, tierToApply);
  } catch (err) {
    logger.warn('stripe_webhook_tier_sync_failed', { eventId, userId, error: err instanceof Error ? err.message : 'Unknown' });
  }
};

/**
 * Handler for customer.subscription.deleted events.
 *
 * Discriminates add-on subscriptions (Living Report / Reverse-Citation Watch)
 * from tier subscriptions (Pro / Team / BYOK / Student) using the
 * `monitor_kind` metadata that we set at add-on checkout time. This is the
 * SAME discriminator we use on `subscription.created/updated` (PR #86 review
 * fix). It is the canonical writer for "is this an add-on subscription?".
 *
 * Add-on cancel: only cancel the monitor — DO NOT downgrade the user's tier
 * (they still have their Pro/Team/BYOK subscription separately).
 *
 * Tier cancel: downgrade to free_demo AND cascade-cancel all of the user's
 * active add-on subscriptions, since the dependency invariant is "add-on
 * requires an active qualifying tier".
 */
const handleSubscriptionDeleted: WebhookEventHandler<StripeEventData> = async (data) => {
  const subscription = data as unknown as SubscriptionData;
  await markSubscriptionCanceled(subscription.id);

  // Always try to cancel a monitor whose stripe_subscription_id matches the
  // deleted subscription. Idempotent on already-cancelled rows.
  try {
    await cancelMonitorByStripeSubscription(subscription.id);
  } catch (err) {
    logger.warn('stripe_monitor_cancel_failed', {
      subscriptionId: subscription.id,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }

  const userId = subscription.metadata?.user_id ?? subscription.metadata?.userId;
  if (!userId) return;

  // Discriminate: add-on subscriptions carry monitor_kind in their metadata.
  // Cancelling an add-on must NOT downgrade the user's tier.
  const isAddonSubscription = Boolean(subscription.metadata?.monitor_kind);
  if (isAddonSubscription) return;

  // Tier subscription cancel: downgrade tier
  try {
    await setUserTier(userId, 'free_demo');
  } catch (err) {
    logger.warn('stripe_webhook_tier_downgrade_failed', { userId, error: err instanceof Error ? err.message : 'Unknown' });
  }

  // Cascade-cancel any of the user's active add-on subscriptions. Without
  // this, the user keeps being charged for Living Reports that no longer
  // have a qualifying tier behind them.
  try {
    await cancelUserAddonSubscriptions(userId);
  } catch (err) {
    logger.warn('stripe_addon_cascade_cancel_failed', {
      userId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }
};

interface InvoiceData {
  subscription?: string | { id?: string } | null;
}

/**
 * Handler for invoice.payment_failed events.
 *
 * Two writers per Rule 10 (state-machine + multi-writer):
 *  1. `stripe_webhook_events.payload.needs_notification` flag — operator/audit
 *     trail. Kept for forensic queries.
 *  2. `user_notifications` row of kind `payment_failed` — user-facing in-app
 *     notification. Read by GET /api/notifications and the frontend
 *     NotificationBanner.
 *
 * The notification insert is best-effort: if the user_id can't be resolved
 * (subscription not yet synced) or the notifications table is missing
 * (deploy skew), we still leave the audit flag in place and log.
 */
const handleInvoicePaymentFailed: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const invoice = data as unknown as InvoiceData;
  const subscriptionId = typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

  await query(
    `UPDATE stripe_webhook_events
     SET payload = payload || $2::jsonb
     WHERE stripe_event_id = $1`,
    [eventId, JSON.stringify({ needs_notification: true, subscription_id: subscriptionId })]
  );

  if (subscriptionId) {
    try {
      await recordSubscriptionPastDueForMonitor(subscriptionId);
    } catch (err) {
      logger.warn('stripe_monitor_past_due_event_failed', {
        subscriptionId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }

    // Best-effort: surface an in-app notification so the user sees a banner.
    try {
      const userId = await resolveUserIdFromStripeSubscription(subscriptionId);
      if (userId) {
        await createUserNotification({
          userId,
          kind: 'payment_failed',
          title: 'Payment failed',
          body: 'We could not charge your card for this billing cycle. Update your payment method to avoid losing access.',
          ctaPath: '/app/billing',
        });
      } else {
        logger.warn('stripe_payment_failed_user_unresolved', { eventId, subscriptionId });
      }
    } catch (err) {
      logger.warn('stripe_payment_failed_notification_insert_failed', {
        subscriptionId,
        error: err instanceof Error ? err.message : 'Unknown',
      });
    }
  }

  logger.info('stripe_invoice_payment_failed_flagged', { eventId, subscriptionId });
};

const STRIPE_EVENT_HANDLERS: Record<string, WebhookEventHandler<StripeEventData>> = {
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': handleSubscriptionCreatedOrUpdated,
  'customer.subscription.updated': handleSubscriptionCreatedOrUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_failed': handleInvoicePaymentFailed,
};

router.post('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const webhookSecret = config.stripe.webhookSecret;
    if (!webhookSecret) {
      res.status(503).json({ error: 'Stripe webhook secret not configured' });
      return;
    }

    const signature = req.headers['stripe-signature'];
    if (!signature || typeof signature !== 'string') {
      res.status(400).json({ error: 'Missing stripe-signature header' });
      return;
    }

    const rawBody = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body));

    interface StripeEvent {
      id: string;
      type: string;
      data: { object: StripeEventData };
    }

    let event: StripeEvent;
    try {
      const stripe = getStripeClient();
      event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) as unknown as StripeEvent;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown verification error';
      logger.warn('stripe_webhook_signature_invalid', { error: message });
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    const result = await dispatchWebhookEvent(
      event.id,
      event.type,
      event.data.object,
      event,
      STRIPE_EVENT_HANDLERS,
      'stripe'
    );

    if (result.status === 'error') {
      res.status(500).json({ error: 'Processing failed' });
      return;
    }

    res.status(200).json({ status: result.status });
  } catch (err) {
    next(err);
  }
});

export default router;
