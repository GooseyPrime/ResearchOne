import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import {
  getStripeClient,
  getTopupAmountForPrice,
  getSubscriptionPriceOptions,
  getTierForSubscriptionPrice,
  isRemovedPlanTier,
  isSelfServeSubscriptionTier,
  REMOVED_PLAN_MESSAGE,
} from '../../services/billing/stripeClient';
import {
  buildMonitorTokenCheckoutSessionCreateParams,
  buildPlanSubscriptionCheckoutSessionCreateParams,
  buildWalletTopupCheckoutSessionCreateParams,
  checkoutSessionPaymentSettled,
} from '../../services/billing/stripeCheckoutSessionParams';
import {
  getMonitorTokenBalance,
  updateMonitorTokenPreferences,
} from '../../services/billing/monitorTokenService';
import { listMonitorTokenPackages, resolveMonitorTokenPackage } from '../../services/billing/monitorTokenCatalog';
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
import { creditMonitorTokensFromCheckoutSession } from '../../services/billing/checkoutMonitorTokens';
import { getBillingHistory } from '../../services/billing/billingEventsService';
import { isTierName } from '../../config/tierRules';
import { getAddonCatalog } from '../../services/billing/addonCatalog';
import {
  ADDON_SUBSCRIPTION_REQUIRED_MESSAGE,
  resolveAddonEligibility,
} from '../../services/billing/addonEligibility';
import { getPurchaseAvailability } from '../../services/billing/purchaseAvailability';
import {
  PLAN_SWITCH_REFUSAL_HTTP_STATUS,
  PLAN_SWITCH_REFUSAL_MESSAGE,
  cancelPendingPlanChange,
  getPendingPlanChange,
  switchSubscriptionPlan,
} from '../../services/billing/planSwitch';
import {
  isSheerIdProgramConfigured,
  isStudentDevBypassAvailable,
  isStudentVerified,
  recordStudentVerification,
} from '../../services/billing/studentVerificationService';

const router = Router();

/**
 * Public: which listed prices can be bought on this deployment. Registered
 * before `requireAuth` on purpose, because the public pricing page asks it for
 * signed-out visitors. It returns booleans only (no price ids, nothing about
 * the caller), so there is nothing here to protect.
 */
router.get('/availability', (_req, res) => {
  res.json(getPurchaseAvailability());
});

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

router.get('/monitor-tokens', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const balance = await getMonitorTokenBalance(userId);
    res.json(balance);
  } catch (err) {
    next(err);
  }
});

router.get('/monitor-tokens/packages', (_req, res) => {
  res.json({ packages: listMonitorTokenPackages() });
});

router.patch('/monitor-tokens/preferences', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as { autoTopupEnabled?: boolean; autoTopupPackageId?: string | null };
    const balance = await updateMonitorTokenPreferences(userId, {
      autoTopupEnabled: body.autoTopupEnabled,
      autoTopupPackageId: body.autoTopupPackageId,
    });
    res.json(balance);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'Invalid auto top-up package') {
      res.status(400).json({ error: msg });
      return;
    }
    next(err);
  }
});

router.post('/monitor-tokens/checkout', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const packageId = String(req.body?.packageId ?? '').trim();
    const pkg = resolveMonitorTokenPackage(packageId);
    if (!pkg) {
      // An unknown id and a pack whose Stripe price is not set on this
      // deployment both land here; neither can be sold.
      res.status(400).json({ error: 'Invalid token package', code: 'ADDON_NOT_AVAILABLE' });
      return;
    }

    // Eligibility is decided before any Stripe customer or session is created,
    // so a refused request leaves nothing behind in Stripe.
    const eligibility = await resolveAddonEligibility(userId);
    if (!eligibility.eligible) {
      res.status(403).json({
        error: ADDON_SUBSCRIPTION_REQUIRED_MESSAGE,
        code: 'ADDON_SUBSCRIPTION_REQUIRED',
        upgradePath: '/app/billing',
      });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    await ensureUserAndTierRow(userId, email);
    const customerId = await getOrCreateStripeCustomer(userId, email);

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create(
      buildMonitorTokenCheckoutSessionCreateParams({
        customerId,
        userId,
        packageId: pkg.id,
        tokenCount: pkg.tokenCount,
        priceId: pkg.priceId,
      })
    );

    res.json({ checkoutUrl: session.url, sessionId: session.id });
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

router.get('/addon-catalog', (_req, res) => {
  res.json({ addons: getAddonCatalog() });
});

router.get('/student/status', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const verified = await isStudentVerified(userId);
    const programIdConfigured = isSheerIdProgramConfigured();
    res.json({
      verified,
      programIdConfigured,
      programId: programIdConfigured ? config.sheerid.programId.trim() : null,
      devBypassAvailable: isStudentDevBypassAvailable(),
    });
  } catch (err) {
    next(err);
  }
});

router.post('/student/verify', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const verificationId = String(req.body?.verificationId ?? '').trim();
    if (!verificationId) {
      res.status(400).json({ error: 'verificationId is required' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;
    await ensureUserAndTierRow(userId, email);

    const result = await recordStudentVerification(userId, verificationId);
    if (!result.verified) {
      res.status(400).json({
        verified: false,
        error: result.error ?? 'Student verification failed',
      });
      return;
    }

    res.json({ verified: true });
  } catch (err) {
    next(err);
  }
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
    const session = await stripe.checkout.sessions.create(
      buildWalletTopupCheckoutSessionCreateParams({
        customerId,
        userId,
        priceId,
        topupAmountCents: amount,
      }),
    );

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
    // Team and Sovereign are not sold. Refused by the plan named and by the
    // plan the price belongs to, so neither a hand-made request nor a price
    // id left in the settings can start a checkout for one.
    if (isRemovedPlanTier(tier) || (catalogTier !== null && isRemovedPlanTier(catalogTier))) {
      res.status(409).json({ error: REMOVED_PLAN_MESSAGE, code: 'PLAN_NOT_AVAILABLE' });
      return;
    }
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
    if (!isSelfServeSubscriptionTier(tier)) {
      const tierLabel = catalogTier.charAt(0).toUpperCase() + catalogTier.slice(1);
      res.status(409).json({
        error: `${tierLabel} subscriptions are coming soon`,
        code: 'PLAN_COMING_SOON',
      });
      return;
    }

    await ensureUserAndTierRow(userId, email);
    const customerId = await getOrCreateStripeCustomer(userId, email);

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create(
      buildPlanSubscriptionCheckoutSessionCreateParams({
        customerId,
        userId,
        priceId,
        tier,
      }),
    );

    res.json({ checkoutUrl: session.url, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

/**
 * A subscriber moves between Pro and BYOK (monthly or annual). The change is
 * scheduled for the end of the billing period they have paid for: nothing is
 * charged or credited now, no Checkout, no second subscription. The body
 * carries only the price to move to. Which subscription is changed is decided
 * from the signed-in user, never from the request.
 */
router.post('/subscription/switch', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const priceId = String(req.body?.priceId ?? '').trim();
    if (!priceId) {
      res.status(400).json({ error: 'priceId is required' });
      return;
    }

    const result = await switchSubscriptionPlan({ userId, priceId });
    if (!result.ok) {
      res.status(PLAN_SWITCH_REFUSAL_HTTP_STATUS[result.reason]).json({
        error: PLAN_SWITCH_REFUSAL_MESSAGE[result.reason],
        code: `PLAN_SWITCH_${result.reason.toUpperCase()}`,
      });
      return;
    }

    res.json({
      scheduled: true,
      pendingChange: { tier: result.tier, billingPeriod: result.billingPeriod, effectiveAt: result.effectiveAt },
    });
  } catch (err) {
    next(err);
  }
});

/** The signed-in user's scheduled plan change, or null. */
router.get('/subscription/pending-change', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json({ pendingChange: await getPendingPlanChange(userId) });
  } catch (err) {
    next(err);
  }
});

/** "Keep my current plan": drops the signed-in user's scheduled plan change. */
router.delete('/subscription/pending-change', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const result = await cancelPendingPlanChange(userId);
    if (!result.ok) {
      res.status(PLAN_SWITCH_REFUSAL_HTTP_STATUS[result.reason]).json({
        error: PLAN_SWITCH_REFUSAL_MESSAGE[result.reason],
        code: `PLAN_SWITCH_${result.reason.toUpperCase()}`,
      });
      return;
    }
    res.json({ cancelled: true });
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

    // What this session bought, so the page can tell a new plan from a top-up
    // or a token pack without inferring it from the resulting tier.
    const sessionMeta = session.metadata ?? {};
    const confirmedCheckout: { kind: 'plan' | 'addon' | 'monitor_tokens' | 'topup'; tier: string | null } =
      session.mode === 'subscription'
        ? sessionMeta.monitor_kind
          ? { kind: 'addon', tier: null }
          : { kind: 'plan', tier: sessionMeta.tier ?? null }
        : sessionMeta.purchase_type === 'monitor_tokens' || sessionMeta.checkout_kind === 'monitor_tokens'
          ? { kind: 'monitor_tokens', tier: null }
          : { kind: 'topup', tier: null };

    if (session.mode === 'subscription') {
      if (session.status !== 'complete') {
        res.status(402).json({
          error: 'Checkout session is not complete yet',
          detail: `status=${session.status ?? 'unknown'} payment_status=${session.payment_status ?? 'unknown'}`,
        });
        return;
      }
      const subscriptionRef = session.subscription;
      if (!subscriptionRef) {
        res.status(402).json({
          error: 'Checkout session has no subscription yet',
          detail: `status=${session.status} payment_status=${session.payment_status ?? 'unknown'}`,
        });
        return;
      }
      const sub =
        typeof subscriptionRef === 'string'
          ? await stripe.subscriptions.retrieve(subscriptionRef)
          : subscriptionRef;
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
        eventId: `checkout_confirm:${sessionId}`,
        source: 'confirm-endpoint',
      });
    } else if (session.mode === 'payment') {
      if (!checkoutSessionPaymentSettled(session)) {
        res.status(402).json({
          error: 'Checkout session is not paid yet',
          detail: `status=${session.status} payment_status=${session.payment_status ?? 'unknown'}`,
        });
        return;
      }
      const meta = session.metadata ?? {};
      const tokenCredited = await creditMonitorTokensFromCheckoutSession(
        sessionId,
        meta,
        `checkout_confirm:${sessionId}`
      );
      if (!tokenCredited) {
        await creditWalletFromCheckoutSession(sessionId, {
          user_id: meta.user_id,
          userId: meta.userId,
          topupAmountCents: meta.topup_amount_cents ?? meta.topupAmountCents,
          price_id: meta.price_id,
        });
      }
    }

    const view = await getBillingSubscriptionView(userId);
    const tokenBalance = await getMonitorTokenBalance(userId);
    res.json({ ...view, monitorTokens: tokenBalance, confirmedCheckout });
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
