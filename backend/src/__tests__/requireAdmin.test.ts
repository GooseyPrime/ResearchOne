import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response } from 'express';

const mockAdmin = vi.hoisted(() => ({
  token: 'breakglass',
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

import { requireAdmin } from '../middleware/clerkAuth';

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  return res as unknown as Response;
}

describe('requireAdmin', () => {
  beforeEach(() => {
    mockAdmin.token = 'breakglass';
    mockAdmin.userIds = ['user_admin'];
  });

  it('returns 401 when no Clerk userId and no admin token', () => {
    const req = {
      auth: { userId: null },
      header: vi.fn(),
      originalUrl: '/api/admin/models',
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 403 when Clerk userId is present but not allowlisted and no valid token', () => {
    const req = {
      auth: { userId: 'user_other' },
      header: vi.fn().mockReturnValue(undefined),
      originalUrl: '/api/admin/models',
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('calls next when userId is in ADMIN_USER_IDS', () => {
    const req = {
      auth: { userId: 'user_admin' },
      header: vi.fn(),
      originalUrl: '/api/admin/models',
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminAuth).toEqual({ method: 'clerk', userId: 'user_admin' });
  });

  it('calls next when x-admin-token matches ADMIN_RUNTIME_TOKEN with no Clerk session', () => {
    const req = {
      auth: { userId: null },
      header: vi.fn((name: string) => (name === 'x-admin-token' ? 'breakglass' : undefined)),
      originalUrl: '/api/admin/runtime/restart',
    } as unknown as Request;
    const res = mockRes();
    const next = vi.fn();
    requireAdmin(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(req.adminAuth).toEqual({ method: 'token', userId: null });
  });
});
