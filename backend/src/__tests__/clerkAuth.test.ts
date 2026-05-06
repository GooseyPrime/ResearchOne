import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

const verifyToken = vi.fn();

vi.mock('@clerk/backend', () => ({
  verifyToken,
}));

vi.mock('../config', () => ({
  config: {
    clerk: {
      secretKey: 'test-secret',
    },
  },
}));

describe('clerkAuthMiddleware', () => {
  it('sets null auth when no bearer token exists', async () => {
    const { clerkAuthMiddleware } = await import('../middleware/clerkAuth');
    const req = { header: vi.fn(() => undefined) } as unknown as Request;
    const next = vi.fn();

    await clerkAuthMiddleware(req, {} as Response, next);

    expect(req.auth?.userId).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('hydrates auth from verified token', async () => {
    verifyToken.mockResolvedValueOnce({ sub: 'user_123', sid: 'sess_1', org_id: 'org_1' });
    const { clerkAuthMiddleware } = await import('../middleware/clerkAuth');
    const req = {
      header: vi.fn((name: string) => (name === 'authorization' ? 'Bearer token_abc' : undefined)),
    } as unknown as Request;
    const next = vi.fn();

    await clerkAuthMiddleware(req, {} as Response, next);

    expect(req.auth).toMatchObject({ userId: 'user_123', sessionId: 'sess_1', orgId: 'org_1' });
  });

  it('requireAuth returns 401 without userId', async () => {
    const { requireAuth } = await import('../middleware/clerkAuth');
    const req = { auth: { userId: null } } as unknown as Request;
    const res = { status: vi.fn(() => res), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});
