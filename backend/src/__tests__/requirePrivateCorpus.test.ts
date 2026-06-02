import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

const mockAdmin = vi.hoisted(() => ({
  userIds: ['user_admin'] as string[],
}));

vi.mock('../config', () => ({
  config: {
    admin: mockAdmin,
  },
}));

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const getUserTier = vi.hoisted(() => vi.fn());
const getUserSubscription = vi.hoisted(() => vi.fn());

vi.mock('../services/tier/tierService', () => ({
  getUserTier,
}));

vi.mock('../services/billing/subscriptionService', () => ({
  getUserSubscription,
}));

vi.mock('../services/billing/entitlementTier', () => ({
  resolveEffectiveEntitlementTier: vi.fn((_sub: unknown, tier: string) => tier),
}));

import { requirePrivateCorpus } from '../middleware/tierEnforcement';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('requirePrivateCorpus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAdmin.userIds = ['user_admin'];
    getUserTier.mockResolvedValue({ tier: 'free_demo' });
    getUserSubscription.mockResolvedValue(null);
  });

  it('returns 401 when unauthenticated', async () => {
    const req = { auth: {} } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requirePrivateCorpus()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for allowlisted admin even when tier is free_demo', async () => {
    const req = { auth: { userId: 'user_admin' } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requirePrivateCorpus()(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('returns 403 for free tier user not on admin allowlist', async () => {
    const req = { auth: { userId: 'user_free' } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requirePrivateCorpus()(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ upgrade_path: '/pricing' })
    );
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next for pro tier user', async () => {
    getUserTier.mockResolvedValue({ tier: 'pro' });
    const req = { auth: { userId: 'user_pro' } } as Request;
    const res = mockRes();
    const next = vi.fn() as NextFunction;
    await requirePrivateCorpus()(req, res, next);
    expect(next).toHaveBeenCalled();
  });
});
