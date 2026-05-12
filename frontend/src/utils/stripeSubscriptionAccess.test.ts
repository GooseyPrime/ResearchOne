import { describe, expect, it } from 'vitest';
import { stripeSubscriptionGrantsPaidPlan } from './stripeSubscriptionAccess';

describe('stripeSubscriptionGrantsPaidPlan', () => {
  it('matches backend plan-access statuses', () => {
    expect(stripeSubscriptionGrantsPaidPlan('active')).toBe(true);
    expect(stripeSubscriptionGrantsPaidPlan('trialing')).toBe(true);
    expect(stripeSubscriptionGrantsPaidPlan('past_due')).toBe(true);
    expect(stripeSubscriptionGrantsPaidPlan('canceled')).toBe(false);
    expect(stripeSubscriptionGrantsPaidPlan(undefined)).toBe(false);
  });
});
