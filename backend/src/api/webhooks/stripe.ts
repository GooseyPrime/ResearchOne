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
import { getStripeClient } from '../../services/billing/stripeClient';
import { dispatchWebhookEvent, type WebhookEventHandler } from './_shared/verifyAndDispatch';
import { query } from '../../db/pool';
import { setUserTier } from '../../services/tier/tierService';
import {
  cancelMonitorByStripeSubscription,
  cancelUserAddonSubscriptions,
} from '../../services/monitoring/parallelMonitorService';
import {
  createUserNotification,
  resolveUserIdFromStripeSubscription,
} from '../../services/notifications/userNotifications';
import { recordSubscriptionPastDueForMonitor } from '../../services/monitoring/parallelMonitorService';
import { creditWalletFromCheckoutSession } from '../../services/billing/checkoutWalletTopup';
import { creditMonitorTokensFromCheckoutSession } from '../../services/billing/checkoutMonitorTokens';
import {
  resolveUserIdForSubscription,
  syncStripeSubscriptionToUser,
  StripeSubscriptionUserUnresolvedError,
  type StripeSubscriptionLike,
} from '../../services/billing/syncStripeSubscription';
import { recordBillingEvent } from '../../services/billing/billingEventsService';
import { markSubscriptionCanceled } from '../../services/billing/subscriptionService';

const router = Router();

type StripeEventData = Record<string, unknown>;

interface CheckoutSessionData {
  id: string;
  mode?: string;
  subscription?: string | StripeSubscriptionLike | null;
  metadata?: {
    userId?: string;
    user_id?: string;
    topupAmountCents?: string;
    topup_amount_cents?: string;
    price_id?: string;
    purchase_type?: string;
    package_id?: string;
    token_amount?: string;
    checkout_kind?: string;
  };
  client_reference_id?: string | null;
}

const handleCheckoutSessionCompleted: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const session = data as unknown as CheckoutSessionData;

  if (session.mode === 'subscription') {
    const stripe = getStripeClient();
    const subId =
      typeof session.subscription === 'string'
        ? session.subscription
        : session.subscription?.id;
    if (!subId) {
      logger.warn('stripe_checkout_subscription_missing', { eventId, sessionId: session.id });
      return;
    }
    const subscription = await stripe.subscriptions.retrieve(subId);
    const userId = await resolveUserIdForSubscription(
      subscription as unknown as StripeSubscriptionLike,
      session.client_reference_id
    );
    if (!userId) {
      throw new StripeSubscriptionUserUnresolvedError(subId, eventId);
    }
    await syncStripeSubscriptionToUser({
      subscription: subscription as unknown as StripeSubscriptionLike,
      userId,
      eventId,
      source: 'webhook',
    });
    return;
  }

  const meta = session.metadata ?? {};
  if (meta.purchase_type === 'monitor_tokens' || meta.checkout_kind === 'monitor_tokens') {
    await creditMonitorTokensFromCheckoutSession(session.id, meta, eventId);
    return;
  }

  const tokenCredited = await creditMonitorTokensFromCheckoutSession(session.id, meta, eventId);
  if (tokenCredited) return;

  await creditWalletFromCheckoutSession(session.id, {
    userId: meta.userId,
    user_id: meta.user_id,
    topupAmountCents: meta.topupAmountCents ?? meta.topup_amount_cents,
    price_id: meta.price_id,
  }, eventId);
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

const handleSubscriptionCreatedOrUpdated: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const subscription = data as unknown as SubscriptionData;
  const userId = await resolveUserIdForSubscription(subscription);
  if (!userId) {
    throw new StripeSubscriptionUserUnresolvedError(subscription.id, eventId);
  }
  await syncStripeSubscriptionToUser({
    subscription,
    userId,
    eventId,
    source: 'webhook',
  });
};

const handleSubscriptionDeleted: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const subscription = data as unknown as SubscriptionData;
  await markSubscriptionCanceled(subscription.id);

  try {
    await cancelMonitorByStripeSubscription(subscription.id);
  } catch (err) {
    logger.warn('stripe_monitor_cancel_failed', {
      subscriptionId: subscription.id,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }

  const userId = await resolveUserIdForSubscription(subscription);
  if (!userId) {
    throw new StripeSubscriptionUserUnresolvedError(subscription.id, eventId);
  }

  const isAddonSubscription = Boolean(subscription.metadata?.monitor_kind);
  if (isAddonSubscription) {
    await recordBillingEvent({
      userId,
      stripeEventId: eventId,
      stripeSubscriptionId: subscription.id,
      eventKind: 'addon_canceled',
      addonKind:
        subscription.metadata?.monitor_kind === 'reverse_citation_watch'
          ? 'reverse_citation_watch'
          : 'living_report',
      description: 'Add-on canceled',
      occurredAt: new Date(),
    });
    return;
  }

  try {
    await setUserTier(userId, 'free_demo');
  } catch (err) {
    logger.warn('stripe_webhook_tier_downgrade_failed', {
      userId,
      error: err instanceof Error ? err.message : 'Unknown',
    });
  }

  await recordBillingEvent({
    userId,
    stripeEventId: eventId,
    stripeSubscriptionId: subscription.id,
    eventKind: 'subscription_canceled',
    description: 'Subscription canceled',
    occurredAt: new Date(),
  });

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
  id?: string;
  subscription?: string | { id?: string } | null;
  amount_paid?: number;
  amount_due?: number;
  currency?: string;
  created?: number;
}

const handleInvoicePaymentSucceeded: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const invoice = data as unknown as InvoiceData;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;
  if (!subscriptionId) return;

  const stripe = getStripeClient();
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const userId = await resolveUserIdForSubscription(subscription as unknown as StripeSubscriptionLike);
  if (!userId) {
    throw new StripeSubscriptionUserUnresolvedError(subscriptionId, eventId);
  }

  await syncStripeSubscriptionToUser({
    subscription: subscription as unknown as StripeSubscriptionLike,
    userId,
    eventId,
    source: 'webhook',
  });

  await recordBillingEvent({
    userId,
    stripeEventId: eventId,
    stripeInvoiceId: invoice.id ?? null,
    stripeSubscriptionId: subscriptionId,
    eventKind: 'invoice_paid',
    amountCents: invoice.amount_paid ?? null,
    currency: invoice.currency ?? null,
    description: 'Invoice paid',
    occurredAt: invoice.created ? new Date(invoice.created * 1000) : new Date(),
  });
};

const handleInvoicePaymentFailed: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const invoice = data as unknown as InvoiceData;
  const subscriptionId =
    typeof invoice.subscription === 'string' ? invoice.subscription : invoice.subscription?.id;

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
        await recordBillingEvent({
          userId,
          stripeEventId: eventId,
          stripeInvoiceId: invoice.id ?? null,
          stripeSubscriptionId: subscriptionId,
          eventKind: 'invoice_payment_failed',
          amountCents: invoice.amount_due ?? null,
          currency: invoice.currency ?? null,
          description: 'Invoice payment failed',
          occurredAt: invoice.created ? new Date(invoice.created * 1000) : new Date(),
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

/**
 * Event routing, by what the customer actually bought.
 *
 * ResearchOne sells three distinct things through Stripe and they settle through
 * different events. Conflating them is how a payment "succeeds" while a balance
 * never moves.
 *
 * 1. RECURRING SUBSCRIPTIONS (Checkout `mode: 'subscription'`)
 *    Buys: a tier, whose entitlements are evaluated live on every request.
 *    There is no balance to increment — the tier IS the entitlement.
 *    Settles via: `checkout.session.completed` (initial),
 *    `customer.subscription.created|updated|deleted` (lifecycle),
 *    `invoice.payment_succeeded|failed` (renewal health).
 *    Ongoing obligation: active status must be MONITORED. A subscription lapses
 *    without any user action — card expiry, dispute, dunning — so the tier must
 *    be revoked on `deleted` and flagged on `payment_failed`.
 *    100%-OFF COUPONS: a fully discounted subscription produces a $0 invoice
 *    with NO PaymentIntent and NO charge. `checkout.session.completed` still
 *    fires and tier sync still works, but any handler keyed on a non-null
 *    `payment_intent` will not run. A coupon-only test therefore proves tier
 *    sync and proves NOTHING about (2) or (3) below.
 *
 * 2. WALLET TOP-UPS (Checkout `mode: 'payment'`)
 *    Buys: prepaid credit, held as a ledger balance and DEBITED INTERNALLY as
 *    the user consumes paid features — run add-ons (Devil's Advocate Review,
 *    Parallel Search, Parallel Extract, Smart Citations) and any per-run
 *    surcharge the tier does not already cover.
 *    Settles via: `checkout.session.completed` only, through
 *    `creditWalletFromCheckoutSession`.
 *    Ongoing obligation: none from Stripe. Once credited, the balance is ours to
 *    debit, so correctness rests entirely on the credit landing exactly once —
 *    hence the idempotency guard in `dispatchWebhookEvent`.
 *
 * 3. MONITOR TOKEN PACKAGES (Checkout `mode: 'payment'`)
 *    Buys: a countable quantity of monitor tokens, credited like (2) but drawn
 *    down by monitor scheduling rather than by run add-ons.
 *    Settles via: `checkout.session.completed` through
 *    `creditMonitorTokensFromCheckoutSession`.
 *
 * Practical consequence: (1) is verified by watching subscription state over
 * time; (2) and (3) are verified by asserting the ledger moved by the expected
 * amount exactly once. Testing (1) does not test (2) or (3).
 */
const STRIPE_EVENT_HANDLERS: Record<string, WebhookEventHandler<StripeEventData>> = {
  'checkout.session.completed': handleCheckoutSessionCompleted,
  'customer.subscription.created': handleSubscriptionCreatedOrUpdated,
  'customer.subscription.updated': handleSubscriptionCreatedOrUpdated,
  'customer.subscription.deleted': handleSubscriptionDeleted,
  'invoice.payment_succeeded': handleInvoicePaymentSucceeded,
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

    // Stripe signatures are computed over the exact raw request bytes.
    // If this route receives parsed JSON, verification cannot be trusted.
    if (!Buffer.isBuffer(req.body)) {
      logger.error('stripe_webhook_raw_body_missing', {
        bodyType: typeof req.body,
      });
      res.status(500).json({
        error: 'Stripe webhook misconfigured',
        detail: 'Expected raw Buffer body. Ensure express.raw() middleware is mounted before JSON parsing.',
      });
      return;
    }
    const rawBody = req.body;

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
