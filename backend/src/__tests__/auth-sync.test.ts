import { describe, expect, it, vi } from 'vitest';

const query = vi.fn();

vi.mock('../db/pool', () => ({ query }));

describe('POST /api/auth/sync', () => {
  it('returns 401 when auth user missing', async () => {
    const router = (await import('../api/routes/auth')).default;
    const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack.find((l) => l.route?.path === '/sync')?.route?.stack[0].handle;
    const req = { auth: { userId: null } } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;

    expect(layer).toBeTypeOf('function');
    await layer!(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('inserts user idempotently for authenticated user', async () => {
    const router = (await import('../api/routes/auth')).default;
    const layer = (router as unknown as { stack: Array<{ route?: { path: string; stack: Array<{ handle: Function }> } }> }).stack.find((l) => l.route?.path === '/sync')?.route?.stack[0].handle;
    const req = { auth: { userId: 'user_1', payload: { email: 'user@example.com' } } } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;

    expect(layer).toBeTypeOf('function');
    await layer!(req, res, vi.fn());

    expect(query).toHaveBeenCalledWith(expect.stringContaining('ON CONFLICT (id) DO UPDATE'), ['user_1', 'user@example.com']);
    expect(res.json).toHaveBeenCalledWith({ ok: true, userId: 'user_1' });
  });
});
