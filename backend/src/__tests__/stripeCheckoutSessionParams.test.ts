import { describe, expect, it } from 'vitest';
import {
  buildMonitorSubscriptionCheckoutSessionCreateParams,
  buildPlanSubscriptionCheckoutSessionCreateParams,
  buildWalletTopupCheckoutSessionCreateParams,
  checkoutSessionPaymentSettled,
  stripeCheckoutPaymentSessionDefaults,
} from '../services/billing/stripeCheckoutSessionParams';
import { stripeCheckoutSubscriptionSessionDefaults } from '../services/billing/stripeClient';

describe('stripeCheckoutSessionParams', () => {
  it('treats no_payment_required as settled for completed sessions', () => {
    expect(
      checkoutSessionPaymentSettled({ status: 'complete', payment_status: 'no_payment_required' }),
    ).toBe(true);
    expect(checkoutSessionPaymentSettled({ status: 'complete', payment_status: 'paid' })).toBe(true);
    expect(checkoutSessionPaymentSettled({ status: 'complete', payment_status: 'unpaid' })).toBe(false);
    expect(
      checkoutSessionPaymentSettled({ status: 'open', payment_status: 'no_payment_required' }),
    ).toBe(false);
  });

  it('plan subscription sessions enable promotion codes and defer payment method when not required', () => {
    const params = buildPlanSubscriptionCheckoutSessionCreateParams({
      customerId: 'cus_test',
      userId: 'user_test',
      priceId: 'price_pro_monthly',
      tier: 'pro',
    });
    expect(params.mode).toBe('subscription');
    expect(params.payment_method_collection).toBe('if_required');
    expect(params.allow_promotion_codes).toBe(true);
    expect(params.customer).toBe('cus_test');
    expect(params.client_reference_id).toBe('user_test');
    expect(params).toMatchObject(stripeCheckoutSubscriptionSessionDefaults);
  });

  it('wallet top-up sessions use payment-mode defaults with if_required', () => {
    const params = buildWalletTopupCheckoutSessionCreateParams({
      customerId: 'cus_test',
      userId: 'user_test',
      priceId: 'price_wallet_20',
      topupAmountCents: 2000,
    });
    expect(params.mode).toBe('payment');
    expect(params.payment_method_collection).toBe('if_required');
    expect(params.allow_promotion_codes).toBe(true);
    expect(params).toMatchObject(stripeCheckoutPaymentSessionDefaults);
  });

  it('monitor subscription sessions attach customer and subscription defaults', () => {
    const params = buildMonitorSubscriptionCheckoutSessionCreateParams({
      customerId: 'cus_test',
      userId: 'user_test',
      reportId: 'report-uuid',
      monitorKind: 'living_report',
      priceId: 'price_living_report',
    });
    expect(params.mode).toBe('subscription');
    expect(params.payment_method_collection).toBe('if_required');
    expect(params.customer).toBe('cus_test');
    expect(params.client_reference_id).toBe('user_test');
    expect(params.metadata?.monitor_kind).toBe('living_report');
  });
});
