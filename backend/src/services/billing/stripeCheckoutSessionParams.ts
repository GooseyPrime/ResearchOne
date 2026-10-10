import { config } from '../../config';
import {
  stripeCheckoutAllowPromotionCodes,
  stripeCheckoutSubscriptionSessionDefaults,
} from './stripeClient';

/**
 * Payment-mode Checkout defaults: promotion codes.
 */
export const stripeCheckoutPaymentSessionDefaults = {
  ...stripeCheckoutAllowPromotionCodes,
} as const;

/**
 * True when a completed Checkout session has no remaining payment to collect
 * (paid charge or $0 / fully discounted).
 */
export function checkoutSessionPaymentSettled(params: {
  status: string | null;
  payment_status: string | null;
}): boolean {
  if (params.status !== 'complete') return false;
  const paymentStatus = params.payment_status;
  return paymentStatus === 'paid' || paymentStatus === 'no_payment_required';
}

export function buildWalletTopupCheckoutSessionCreateParams(args: {
  customerId: string;
  userId: string;
  priceId: string;
  topupAmountCents: number;
}) {
  return {
    mode: 'payment' as const,
    customer: args.customerId,
    client_reference_id: args.userId,
    ...stripeCheckoutPaymentSessionDefaults,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    metadata: {
      user_id: args.userId,
      price_id: args.priceId,
      topup_amount_cents: String(args.topupAmountCents),
      checkout_kind: 'topup',
    },
  };
}

export function buildPlanSubscriptionCheckoutSessionCreateParams(args: {
  customerId: string;
  userId: string;
  priceId: string;
  tier: string;
}) {
  return {
    mode: 'subscription' as const,
    customer: args.customerId,
    client_reference_id: args.userId,
    ...stripeCheckoutSubscriptionSessionDefaults,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    metadata: {
      user_id: args.userId,
      tier: args.tier,
      price_id: args.priceId,
      checkout_kind: 'subscription',
    },
    subscription_data: {
      metadata: {
        user_id: args.userId,
        tier: args.tier,
        price_id: args.priceId,
      },
    },
  };
}

export function buildMonitorTokenCheckoutSessionCreateParams(args: {
  customerId: string;
  userId: string;
  packageId: string;
  tokenCount: number;
  priceId: string;
}) {
  return {
    mode: 'payment' as const,
    customer: args.customerId,
    client_reference_id: args.userId,
    ...stripeCheckoutPaymentSessionDefaults,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    metadata: {
      user_id: args.userId,
      price_id: args.priceId,
      purchase_type: 'monitor_tokens',
      package_id: args.packageId,
      token_amount: String(args.tokenCount),
      checkout_kind: 'monitor_tokens',
    },
  };
}

export function buildMonitorSubscriptionCheckoutSessionCreateParams(args: {
  customerId: string;
  userId: string;
  reportId: string;
  monitorKind: string;
  priceId: string;
}) {
  return {
    mode: 'subscription' as const,
    customer: args.customerId,
    client_reference_id: args.userId,
    ...stripeCheckoutSubscriptionSessionDefaults,
    line_items: [{ price: args.priceId, quantity: 1 }],
    success_url: config.stripe.successUrl,
    cancel_url: config.stripe.cancelUrl,
    metadata: {
      user_id: args.userId,
      report_id: args.reportId,
      monitor_kind: args.monitorKind,
    },
    subscription_data: {
      metadata: {
        user_id: args.userId,
        report_id: args.reportId,
        monitor_kind: args.monitorKind,
      },
    },
  };
}

/**
 * What a confirmed Checkout session bought and for how much, for the page's
 * purchase count (RJ-023). The item is named the way the frontend names it
 * when checkout starts (`frontend/src/lib/analyticsEvents.ts`). It holds no
 * person, no report and no Stripe price id.
 */
export function confirmedPurchaseSummary(session: {
  mode?: string | null;
  amount_total?: number | null;
  currency?: string | null;
  metadata?: Record<string, string> | null;
  subscription?: unknown;
}): { itemId: string; valueCents: number; currency: string } {
  const meta = session.metadata ?? {};
  let itemId: string;
  if (session.mode === 'subscription') {
    if (meta.monitor_kind) {
      itemId = `addon_${meta.monitor_kind}`;
    } else {
      const sub = session.subscription as
        | { items?: { data?: Array<{ price?: { recurring?: { interval?: string } | null } | null }> } }
        | string
        | null
        | undefined;
      const interval = sub && typeof sub === 'object' ? sub.items?.data?.[0]?.price?.recurring?.interval : undefined;
      itemId = `plan_${meta.tier ?? 'unknown'}_${interval === 'year' ? 'annual' : 'monthly'}`;
    }
  } else if (meta.purchase_type === 'monitor_tokens' || meta.checkout_kind === 'monitor_tokens') {
    itemId = `living_report_tokens_${meta.package_id ?? 'unknown'}`;
  } else {
    itemId = `wallet_topup_${meta.topup_amount_cents ?? meta.topupAmountCents ?? 'unknown'}`;
  }
  return {
    itemId,
    valueCents: typeof session.amount_total === 'number' ? session.amount_total : 0,
    currency: (session.currency ?? 'usd').toUpperCase(),
  };
}
