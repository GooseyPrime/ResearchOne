import { describe, expect, it } from 'vitest';
import { parseStripeCheckoutReturnSessionId } from './checkout';

describe('parseStripeCheckoutReturnSessionId', () => {
  it('accepts a real Stripe Checkout session id', () => {
    expect(parseStripeCheckoutReturnSessionId('cs_live_abc123')).toBe('cs_live_abc123');
  });

  it('rejects unreplaced Stripe template (encoded or literal)', () => {
    expect(parseStripeCheckoutReturnSessionId('{CHECKOUT_SESSION_ID}')).toBeNull();
    expect(parseStripeCheckoutReturnSessionId('%7BCHECKOUT_SESSION_ID%7D')).toBeNull();
  });
});
