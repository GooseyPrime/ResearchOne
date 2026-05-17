import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import {
  getStripeClient,
  getTopupAmountForPrice,
  getSubscriptionPriceOptions,
  getTierForSubscriptionPrice,
  stripeCheckoutAllowPromotionCodes,
  stripeCheckoutSubscriptionCustomerDefaults,
} from '../../services/billing/stripeClient';
import { cancelSubscriptionAtPeriodEnd } from '../../services/billing/subscriptionService';
import { getBillingSubscriptionView } from '../../services/billing/billingSubscriptionView';
import { getWalletSummary, getWalletTransactions } from '../../services/billing/walletService';
import { ensureUserAndTierRow } from '../../services/users/ensureUserRow';
import { getOrCreateStripeCustomer } from '../../services/billing/stripeCustomer';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  syncStripeSubscriptionToUser,
  toSubscriptionLike,
  type StripeSubscriptionInput,
} from '../../services/billing/syncStripeSubscription';
import { creditWalletFromCheckoutSession } from '../../services/billing/checkoutWalletTopup';
import { getBillingHistory } from '../../services/billing/billingEventsService';
import { isTierName } from '../../config/tierRules';

const router = Router();

router.use(requireAuth);

const confirmEndpointEnabled = process.env.BILLING_CONFIRM_ENDPOINT_ENABLED !== 'false';

router.get('/wallet', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const summary = await getWalletSummary(userId);
    res.json(summary);
  } catch (err) {
    next(err);
  }
});

router.get('/subscription', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const subscription = await getBillingSubscriptionView(userId);
    res.json(subscription);
  } catch (err) {
    next(err);
  }
});

router.get('/history', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '25'), 10), 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);
    const result = await getBillingHistory(userId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/topup-options', (_req, res) => {
  const options = [
    { label: 'Top up $20', amountCents: 2000, priceId: config.stripe.priceIds.wallet20 },
    { label: 'Top up $50', amountCents: 5000, priceId: config.stripe.priceIds.wallet50 },
    { label: 'Top up $100', amountCents: 10000, priceId: config.stripe.priceIds.wallet100 },
  ].filter((row) => Boolean(row.priceId));
  res.json({ options });
});

router.get('/subscription-options', (_req, res) => {
  const options = getSubscriptionPriceOptions();
  res.json({ options });
});

router.post('/checkout/topup', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    const priceId = String(req.body?.priceId ?? '');
    const amount = getTopupAmountForPrice(priceId);
    if (!amount) {
      res.status(400).json({ error: 'Invalid top-up price' });
      return;
    }

    await ensureUserAndTierRow(userId, email);
    const customerId = await getOrCreateStripeCustomer(userId, email);

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      customer: customerId,
      client_reference_id: userId,
      ...stripeCheckoutAllowPromotionCodes,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: {
        user_id: userId,
        price_id: priceId,
        topup_amount_cents: String(amount),
        checkout_kind: 'topup',
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

router.post('/checkout/subscription', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    const priceId = String(req.body?.priceId ?? '');
    const tier = String(req.body?.tier ?? 'pro');
    if (!priceId) {
      res.status(400).json({ error: 'priceId is required' });
      return;
    }

    const catalogTier = getTierForSubscriptionPrice(priceId);
    if (!catalogTier) {
      res.status(400).json({ error: 'Unknown subscription price' });
      return;
    }
    if (tier !== catalogTier) {
      res.status(400).json({ error: 'tier does not match priceId' });
      return;
    }
    if (!isTierName(tier) || tier === 'anonymous' || tier === 'free_demo') {
      res.status(400).json({ error: 'Invalid subscription tier' });
      return;
    }

    await ensureUserAndTierRow(userId, email);
    const customerId = await getOrCreateStripeCustomer(userId, email);

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      client_reference_id: userId,
      ...stripeCheckoutSubscriptionCustomerDefaults,
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: {
        user_id: userId,
        tier,
        price_id: priceId,
        checkout_kind: 'subscription',
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          tier,
          price_id: priceId,
        },
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

router.post('/checkout/confirm', async (req, res, next) => {
  try {
    if (!confirmEndpointEnabled) {
      res.status(503).json({ error: 'Checkout confirm is temporarily disabled' });
      return;
    }

    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const sessionId = String(req.body?.sessionId ?? '');
    if (!sessionId.startsWith('cs_')) {
      res.status(400).json({ error: 'Invalid sessionId' });
      return;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.retrieve(sessionId, {
      expand: ['subscription', 'customer'],
    });

    const sessionUserId =
      session.metadata?.user_id ?? session.metadata?.userId ?? null;
    const subscriptionUserId =
      session.subscription && typeof session.subscription === 'object'
        ? (session.subscription.metadata?.user_id ?? null)
        : null;
    const ref = session.client_reference_id ?? null;
    const claimed = sessionUserId ?? subscriptionUserId ?? ref;
    if (!claimed || claimed !== userId) {
      logger.warn('checkout_confirm_ownership_mismatch', {
        userId,
        sessionId,
        claimed,
      });
      res.status(403).json({ error: 'Session does not belong to this user' });
      return;
    }

    if (session.mode === 'subscription' && session.subscription) {
      const sub =
        typeof session.subscription === 'string'
          ? await stripe.subscriptions.retrieve(session.subscription)
          : session.subscription;
      const periodEnd =
        (sub as { current_period_end?: number }).current_period_end ??
        Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60;
      const subscriptionLike: StripeSubscriptionInput = {
        id: sub.id,
        customer: sub.customer as StripeSubscriptionInput['customer'],
        status: sub.status,
        current_period_end: periodEnd,
        cancel_at_period_end: sub.cancel_at_period_end,
        metadata: sub.metadata as StripeSubscriptionInput['metadata'],
        items: {
          data: sub.items.data.map((item) => ({
            id: item.id,
            price: item.price,
          })),
        },
      };
      await syncStripeSubscriptionToUser({
        subscription: toSubscriptionLike(subscriptionLike),
        userId,
        source: 'confirm-endpoint',
      });
    } else if (session.mode === 'payment') {
      await creditWalletFromCheckoutSession(sessionId, {
        user_id: session.metadata?.user_id,
        userId: session.metadata?.userId,
        topupAmountCents: session.metadata?.topup_amount_cents ?? session.metadata?.topupAmountCents,
        price_id: session.metadata?.price_id,
      });
    }

    const view = await getBillingSubscriptionView(userId);
    res.json(view);
  } catch (err) {
    next(err);
  }
});

router.post('/portal-session', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    const customerId = await getOrCreateStripeCustomer(userId, email);
    const stripe = getStripeClient();
    const returnUrl = config.stripe.successUrl.split('?')[0];
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    res.json({ url: portal.url });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const limit = Math.min(Math.max(parseInt(String(req.query.limit ?? '50'), 10), 1), 100);
    const offset = Math.max(parseInt(String(req.query.offset ?? '0'), 10), 0);

    const result = await getWalletTransactions(userId, limit, offset);
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/cancel-subscription', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const result = await cancelSubscriptionAtPeriodEnd(userId);

    if (!result.success) {
      res.status(400).json({ error: result.error });
      return;
    }

    res.json({ success: true, message: 'Subscription will be canceled at the end of the current billing period' });
  } catch (err) {
    next(err);
  }
});

export default router;
