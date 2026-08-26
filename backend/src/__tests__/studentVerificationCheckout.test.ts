/** Student is visibly deferred and cannot be entered through a direct API call. */
import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../middleware/clerkAuth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../middleware/clerkAuth')>();
  return {
    ...actual,
    clerkAuthMiddleware: (req: import('express').Request, _res: import('express').Response, next: import('express').NextFunction) => {
      req.auth = {
        userId: 'user_test',
        orgId: null,
        sessionId: null,
        payload: { email: 'student@example.com' },
      };
      next();
    },
  };
});

const studentVerificationMocks = vi.hoisted(() => ({
  isStudentVerified: vi.fn(),
}));

vi.mock('../services/billing/studentVerificationService', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/studentVerificationService')>();
  return {
    ...actual,
    isStudentVerified: studentVerificationMocks.isStudentVerified,
  };
});

const stripeMocks = vi.hoisted(() => ({
  sessionsCreate: vi.fn(),
}));

vi.mock('../services/billing/stripeClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/billing/stripeClient')>();
  return {
    ...actual,
    getStripeClient: () => ({
      checkout: { sessions: { create: stripeMocks.sessionsCreate } },
    }),
    getTopupAmountForPrice: () => null,
    getSubscriptionPriceOptions: () => [],
    getTierForSubscriptionPrice: (priceId: string) => {
      if (priceId === 'price_student_monthly') return 'student';
      if (priceId === 'price_team_monthly') return 'team';
      return null;
    },
  };
});

vi.mock('../services/users/ensureUserRow', () => ({
  ensureUserAndTierRow: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../services/billing/stripeCustomer', () => ({
  getOrCreateStripeCustomer: vi.fn().mockResolvedValue('cus_test'),
}));

import request from 'supertest';
import testApp from '../api/app';

beforeEach(() => {
  studentVerificationMocks.isStudentVerified.mockReset();
  stripeMocks.sessionsCreate.mockReset();
  stripeMocks.sessionsCreate.mockResolvedValue({
    id: 'cs_test',
    url: 'https://checkout.stripe.com/test',
  });
});

describe('POST /api/billing/checkout/subscription — deferred plans', () => {
  it.each([
    ['student', 'price_student_monthly', 'Student'],
    ['team', 'price_team_monthly', 'Team'],
  ])('returns 409 when a user attempts %s checkout', async (tier, priceId, label) => {
    studentVerificationMocks.isStudentVerified.mockResolvedValue(false);

    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId, tier });

    expect(res.status).toBe(409);
    expect(res.body).toEqual({
      error: `${label} subscriptions are coming soon`,
      code: 'PLAN_COMING_SOON',
    });
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
    expect(studentVerificationMocks.isStudentVerified).not.toHaveBeenCalled();
  });
});
