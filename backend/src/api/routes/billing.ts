import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { getStripeClient, getTopupAmountForPrice } from '../../services/billing/stripeClient';
import { getUserSubscription } from '../../services/billing/subscriptionService';
import { getWalletSummary } from '../../services/billing/walletService';
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
    { amountCents: 2000, priceId: config.stripe.priceIds.wallet20 },
    { amountCents: 5000, priceId: config.stripe.priceIds.wallet50 },
    { amountCents: 10000, priceId: config.stripe.priceIds.wallet100 },
  ].filter((row) => Boolean(row.priceId));
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
    });

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

export default router;
