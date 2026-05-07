import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool', () => ({ query }));

type AuthRouterLayer = { route?: { path: string; stack: Array<{ handle: RequestHandler }> } };

describe('POST /api/auth/sync', () => {
  it('returns 401 when auth user missing', async () => {
    const router = (await import('../api/routes/auth')).default as unknown as { stack: AuthRouterLayer[] };
    const layer = router.stack.find((l) => l.route?.path === '/sync')?.route?.stack[0].handle;
    const req = { auth: { userId: null } } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    expect(layer).toBeTypeOf('function');
    await layer!(req, res, vi.fn() as NextFunction);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('inserts user idempotently for authenticated user', async () => {
    const router = (await import('../api/routes/auth')).default as unknown as { stack: AuthRouterLayer[] };
    const layer = router.stack.find((l) => l.route?.path === '/sync')?.route?.stack[0].handle;
    const req = { auth: { userId: 'user_1', payload: { email: 'user@example.com' } } } as unknown as Request;
    const res = { status: vi.fn(), json: vi.fn() } as unknown as Response;
    vi.mocked(res.status).mockReturnValue(res as Response);

    expect(layer).toBeTypeOf('function');
    await layer!(req, res, vi.fn() as NextFunction);

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (id) DO UPDATE'), ['user_1', 'user@example.com']);
    expect(res.json).toHaveBeenCalledWith({ ok: true, userId: 'user_1' });
  });
});
