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
import { syncSubscription, markSubscriptionCanceled } from '../../services/billing/subscriptionService';
import { dispatchWebhookEvent, type WebhookEventHandler } from './_shared/verifyAndDispatch';
import { query } from '../../db/pool';
import { setUserTier } from '../../services/tier/tierService';
import { isTierName } from '../../config/tierRules';

const router = Router();

type StripeEventData = Record<string, unknown>;

function deriveTierFromLookupKey(lookupKey: string | null | undefined): import('../../config/tierRules').TierName | null {
  if (!lookupKey) return null;
  const key = lookupKey.toLowerCase();
  if (key.startsWith('student')) return 'student';
  if (key.startsWith('pro')) return 'pro';
  if (key.startsWith('team')) return 'team';
  if (key.startsWith('byok')) return 'byok';
  return null;
}

interface CheckoutSessionData {
  id: string;
  metadata?: { user_id?: string; price_id?: string };
}

/**
 * Handler for checkout.session.completed events (wallet top-ups).
 * Credits the user's wallet based on the checkout session metadata.
 */
const handleCheckoutSessionCompleted: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const session = data as unknown as CheckoutSessionData;
  const userId = session.metadata?.user_id;
  const priceId = session.metadata?.price_id;

  if (!userId || !priceId) {
    logger.warn('stripe_checkout_missing_metadata', { eventId, sessionId: session.id });
    return;
  }

  const amountCents = getTopupAmountForPrice(priceId);
  if (amountCents === null) {
    logger.warn('stripe_checkout_unknown_price', { eventId, priceId });
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
  metadata?: { user_id?: string };
  items?: { data?: Array<{ price?: { lookup_key?: string | null } }> };
}

/**
 * Handler for customer.subscription.created and customer.subscription.updated events.
 * Syncs the subscription state to the local database.
 */
const handleSubscriptionCreatedOrUpdated: WebhookEventHandler<StripeEventData> = async (data, eventId) => {
  const subscription = data as unknown as SubscriptionData;
  const userId = subscription.metadata?.user_id;

  if (!userId) {
    logger.warn('stripe_subscription_missing_user_id', { eventId, subscriptionId: subscription.id });
    return;
  }

  const item = subscription.items?.data?.[0];
  const priceLookupKey = item?.price?.lookup_key ?? null;

  await syncSubscription(
    userId,
    typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id,
    subscription.id,
    subscription.status,
    new Date(subscription.current_period_end * 1000),
    subscription.cancel_at_period_end,
    priceLookupKey
  );

  // Sync tier in user_tiers table to match subscription plan
  const tierFromLookup = deriveTierFromLookupKey(priceLookupKey);
  if (tierFromLookup && subscription.status === 'active') {
    try {
      await setUserTier(userId, tierFromLookup);
    } catch (err) {
      logger.warn('stripe_webhook_tier_sync_failed', { eventId, userId, error: err instanceof Error ? err.message : 'Unknown' });
    }
  }
};

/**
 * Handler for customer.subscription.deleted events.
 * Marks the subscription as canceled. Access continues until current_period_end
 * (handled by daily cron, not immediate).
 */
const handleSubscriptionDeleted: WebhookEventHandler<StripeEventData> = async (data) => {
  const subscription = data as unknown as SubscriptionData;
  await markSubscriptionCanceled(subscription.id);
};

interface InvoiceData {
  subscription?: string | { id?: string } | null;
}

/**
 * Handler for invoice.payment_failed events.
 * Flags the event in DB for later notification work (email notification out of scope per Work Order F).
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
