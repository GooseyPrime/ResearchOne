import { describe, expect, it } from 'vitest';
import {
  appendStripeCheckoutSessionIdTemplate,
  assertStripeCheckoutSuccessUrlHasSessionTemplate,
  resolveStripeCheckoutRedirect,
} from '../config/stripeCheckoutUrls';

describe('resolveStripeCheckoutRedirect', () => {
  const devDefault = 'http://localhost:5173/app/billing?checkout=success';

  it('returns dev default when not production and env unset', () => {
    expect(
      resolveStripeCheckoutRedirect(undefined, 'STRIPE_CHECKOUT_SUCCESS_URL', 'development', devDefault),
    ).toBe(devDefault);
  });

  it('returns explicit value in development', () => {
    expect(
      resolveStripeCheckoutRedirect(
        'http://localhost:5173/custom',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'development',
        devDefault,
      ),
    ).toBe('http://localhost:5173/custom');
  });

  it('requires https non-localhost URL in production', () => {
    expect(() =>
      resolveStripeCheckoutRedirect(undefined, 'STRIPE_CHECKOUT_SUCCESS_URL', 'production', devDefault),
    ).toThrow(/must be set in production/);
    expect(() =>
      resolveStripeCheckoutRedirect(
        'http://researchone.io/app',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'production',
        devDefault,
      ),
    ).toThrow(/https/);
    expect(() =>
      resolveStripeCheckoutRedirect(
        'https://localhost/app',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'production',
        devDefault,
      ),
    ).toThrow(/localhost/);
  });

  it('appends session_id template when legacy production success URL omits it', () => {
    expect(
      resolveStripeCheckoutRedirect(
        'https://researchone.io/app/billing?checkout=success',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'production',
        devDefault,
      ),
    ).toBe(
      'https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    );

    expect(
      resolveStripeCheckoutRedirect(
        'https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'production',
        devDefault,
      ),
    ).toBe('https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}');
  });

  it('appendStripeCheckoutSessionIdTemplate is idempotent', () => {
    const withTemplate =
      'https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}';
    expect(appendStripeCheckoutSessionIdTemplate(withTemplate)).toBe(withTemplate);
    const appended = appendStripeCheckoutSessionIdTemplate(
      'https://researchone.io/app/billing?checkout=success',
    );
    expect(appended).toBe(
      'https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    );
    expect(appendStripeCheckoutSessionIdTemplate(
      'https://researchone.io/app/billing?checkout=success&session_id=%7BCHECKOUT_SESSION_ID%7D',
    )).toBe(
      'https://researchone.io/app/billing?checkout=success&session_id={CHECKOUT_SESSION_ID}',
    );
  });

  it('assertStripeCheckoutSuccessUrlHasSessionTemplate is a no-op outside production', () => {
    expect(() =>
      assertStripeCheckoutSuccessUrlHasSessionTemplate(
        'https://example.com/success',
        'STRIPE_CHECKOUT_SUCCESS_URL',
        'development',
      ),
    ).not.toThrow();
  });
});
