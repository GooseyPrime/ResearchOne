/**
 * Student tier checkout requires SheerID verification (or admin allowlist).
 */
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
    getTierForSubscriptionPrice: (priceId: string) =>
      priceId === 'price_student_monthly' ? 'student' : null,
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

describe('POST /api/billing/checkout/subscription — student verification gate', () => {
  it('returns 403 when unverified user attempts student checkout', async () => {
    studentVerificationMocks.isStudentVerified.mockResolvedValue(false);

    const res = await request(testApp)
      .post('/api/billing/checkout/subscription')
      .send({ priceId: 'price_student_monthly', tier: 'student' });

    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      error: 'Student verification is required before subscribing to the Student plan',
      code: 'STUDENT_VERIFICATION_REQUIRED',
    });
    expect(stripeMocks.sessionsCreate).not.toHaveBeenCalled();
    expect(studentVerificationMocks.isStudentVerified).toHaveBeenCalledWith('user_test');
  });
});
