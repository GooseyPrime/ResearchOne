/**
 * RJ-023: what `/billing/checkout/confirm` tells the page about a purchase,
 * for the purchase count. The item is named the way the frontend names it
 * when checkout starts; no person and no Stripe price id is in it.
 */
import { describe, expect, it } from 'vitest';
import { confirmedPurchaseSummary } from '../services/billing/stripeCheckoutSessionParams';

describe('RJ-023: confirmedPurchaseSummary', () => {
  it('names a plan by tier and billing period', () => {
    const session = {
      mode: 'subscription',
      amount_total: 29000,
      currency: 'usd',
      metadata: { user_id: 'user_test', tier: 'pro', price_id: 'price_pro_a', checkout_kind: 'subscription' },
      subscription: { items: { data: [{ price: { id: 'price_pro_a', recurring: { interval: 'year' } } }] } },
    };
    expect(confirmedPurchaseSummary(session)).toEqual({ itemId: 'plan_pro_annual', valueCents: 29000, currency: 'USD' });
    expect(
      confirmedPurchaseSummary({ ...session, amount_total: 2900, subscription: 'sub_123' }),
    ).toEqual({ itemId: 'plan_pro_monthly', valueCents: 2900, currency: 'USD' });
  });

  it('names a report add-on, a token pack and a wallet top-up', () => {
    expect(
      confirmedPurchaseSummary({
        mode: 'subscription',
        amount_total: 1500,
        currency: 'usd',
        metadata: { user_id: 'user_test', report_id: 'r1', monitor_kind: 'reverse_citation_watch' },
      }).itemId,
    ).toBe('addon_reverse_citation_watch');
    expect(
      confirmedPurchaseSummary({
        mode: 'payment',
        amount_total: 2500,
        currency: 'usd',
        metadata: { user_id: 'user_test', purchase_type: 'monitor_tokens', package_id: 'pack_5' },
      }),
    ).toEqual({ itemId: 'living_report_tokens_pack_5', valueCents: 2500, currency: 'USD' });
    expect(
      confirmedPurchaseSummary({
        mode: 'payment',
        amount_total: 2000,
        currency: 'usd',
        metadata: { user_id: 'user_test', price_id: 'price_topup', topup_amount_cents: '2000', checkout_kind: 'topup' },
      }),
    ).toEqual({ itemId: 'wallet_topup_2000', valueCents: 2000, currency: 'USD' });
  });

  it('holds no person, report or price id, and survives a session with nothing in it', () => {
    const summary = confirmedPurchaseSummary({
      mode: 'subscription',
      amount_total: 1500,
      currency: 'usd',
      metadata: { user_id: 'user_test', report_id: 'r1', monitor_kind: 'living_report', price_id: 'price_x' },
    });
    expect(JSON.stringify(summary)).not.toMatch(/user_test|r1|price_x/);
    expect(confirmedPurchaseSummary({})).toEqual({ itemId: 'wallet_topup_unknown', valueCents: 0, currency: 'USD' });
  });
});
