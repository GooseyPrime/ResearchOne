import { describe, expect, it, vi } from 'vitest';

const query = vi.fn();
const verify = vi.fn();

vi.mock('../db/pool', () => ({ query }));
vi.mock('../config', () => ({ config: { clerk: { webhookSecret: 'whsec_test' } } }));
vi.mock('@clerk/backend', () => ({ verifyToken: vi.fn() }));
vi.mock('svix', () => ({
  Webhook: class MockWebhook {
    verify = verify;
  },
}));
vi.mock('../utils/logger', () => ({ logger: { warn: vi.fn() } }));

describe('clerk webhook route', () => {
  it('returns 400 for invalid signature', async () => {
    verify.mockImplementationOnce(() => {
      throw new Error('bad sig');
    });
    const router = (await import('../api/webhooks/clerk')).default;
    const layer = (router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: Function }> } }> }).stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');
    const req = { header: (name: string) => (name.startsWith('svix-') ? 'x' : undefined), body: '{}' } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;

    await layer!(req, res, vi.fn());

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('inserts user on user.created event', async () => {
    verify.mockReturnValueOnce({ type: 'user.created', data: { id: 'user_1', email_addresses: [{ email_address: 'a@b.c' }] } });
    const router = (await import('../api/webhooks/clerk')).default;
    const layer = (router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: Function }> } }> }).stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');
    const req = { header: (name: string) => (name.startsWith('svix-') ? 'x' : undefined), body: '{}' } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;

    await layer!(req, res, vi.fn());

    expect(query).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });

  it('verifies Buffer bodies as UTF-8 (production express.raw shape)', async () => {
    verify.mockImplementationOnce((payload: string) => {
      expect(payload).toBe('{"type":"user.created","data":{}}');
      return { type: 'user.created', data: { id: 'user_buf', email_addresses: [{ email_address: 'z@y.x' }] } };
    });
    const router = (await import('../api/webhooks/clerk')).default;
    const layer = (router as unknown as { stack: Array<{ route?: { stack: Array<{ handle: Function }> } }> }).stack.find((l) => l.route)?.route?.stack[0].handle;
    expect(layer).toBeTypeOf('function');
    const payloadUtf8 = '{"type":"user.created","data":{}}';
    const req = {
      header: (name: string) => (name.startsWith('svix-') ? 'x' : undefined),
      body: Buffer.from(payloadUtf8, 'utf8'),
    } as any;
    const res = { status: vi.fn(() => res), json: vi.fn() } as any;

    await layer!(req, res, vi.fn());

    expect(verify).toHaveBeenCalledWith(payloadUtf8, expect.any(Object));
    expect(query).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ ok: true });
  });
});
