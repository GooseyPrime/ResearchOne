import { describe, expect, it } from 'vitest';
import {
  stripeCheckoutAllowPromotionCodes,
  stripeCheckoutSubscriptionCustomerDefaults,
} from '../services/billing/stripeClient';

describe('Stripe Checkout session customer defaults', () => {
  it('enables promotion codes on payment-mode sessions (wallet top-up)', () => {
    expect(stripeCheckoutAllowPromotionCodes).toEqual({ allow_promotion_codes: true });
  });

  it('enables promotion codes and defers payment method when not required (subscriptions)', () => {
    expect(stripeCheckoutSubscriptionCustomerDefaults).toEqual({
      allow_promotion_codes: true,
      payment_method_collection: 'if_required',
    });
  });
});
