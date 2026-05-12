import { describe, expect, it } from 'vitest';
import { stripeSubscriptionStatusGrantsPlanAccess } from '../services/billing/stripeSubscriptionStatus';

describe('stripeSubscriptionStatusGrantsPlanAccess', () => {
  it('returns true for active, trialing, and past_due', () => {
    expect(stripeSubscriptionStatusGrantsPlanAccess('active')).toBe(true);
    expect(stripeSubscriptionStatusGrantsPlanAccess('trialing')).toBe(true);
    expect(stripeSubscriptionStatusGrantsPlanAccess('past_due')).toBe(true);
  });

  it('returns false for terminal / unpaid states', () => {
    expect(stripeSubscriptionStatusGrantsPlanAccess('canceled')).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess('unpaid')).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess('incomplete')).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess('incomplete_expired')).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess('paused')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(stripeSubscriptionStatusGrantsPlanAccess('TRIALING')).toBe(true);
  });

  it('returns false for empty', () => {
    expect(stripeSubscriptionStatusGrantsPlanAccess(undefined)).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess(null)).toBe(false);
    expect(stripeSubscriptionStatusGrantsPlanAccess('')).toBe(false);
  });
});
