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
