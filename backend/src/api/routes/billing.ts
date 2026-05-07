import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { getStripeClient, getTopupAmountForPrice, getSubscriptionPriceOptions } from '../../services/billing/stripeClient';
import { getUserSubscription, cancelSubscriptionAtPeriodEnd } from '../../services/billing/subscriptionService';
import { getWalletSummary, getWalletTransactions } from '../../services/billing/walletService';
import { config } from '../../config';

const router = Router();

router.use(requireAuth);

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

    const subscription = await getUserSubscription(userId);
    res.json(subscription);
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

    const priceId = String(req.body?.priceId ?? '');
    const amount = getTopupAmountForPrice(priceId);
    if (!amount) {
      res.status(400).json({ error: 'Invalid top-up price' });
      return;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: {
        userId,
        topupAmountCents: String(amount),
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

    const priceId = String(req.body?.priceId ?? '');
    const tier = String(req.body?.tier ?? 'pro');
    if (!priceId) {
      res.status(400).json({ error: 'priceId is required' });
      return;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: {
        userId,
        tier,
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          tier,
        },
      },
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
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
