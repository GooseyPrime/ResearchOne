// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Handler = (...args: unknown[]) => void;

const fake = {
  connected: false,
  active: false,
  handlers: new Map<string, Handler>(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  on(event: string, handler: Handler) {
    fake.handlers.set(event, handler);
    return fake;
  },
};
const ioMock = vi.fn((_url: string, _opts: { auth: (cb: (data: { token: string }) => void) => void }) => fake);

vi.mock('socket.io-client', () => ({ io: ioMock }));

async function load() {
  vi.resetModules();
  const session = await import('../../utils/clerkSession');
  const socket = await import('../../utils/socket');
  return { session, socket };
}

describe('live connection carries the signed-in session', () => {
  beforeEach(() => {
    fake.connected = false;
    fake.active = false;
    fake.handlers.clear();
    fake.emit.mockClear();
    fake.connect.mockClear();
    fake.disconnect.mockClear();
    ioMock.mockClear();
  });

  it('sends a fresh session token with every connection attempt', async () => {
    const { session, socket } = await load();
    let current = 'token-1';
    session.registerClerkTokenGetter(async () => current);
    socket.getSocket();
    const auth = ioMock.mock.calls[0]![1].auth;
    const first = await new Promise<{ token: string }>((resolve) => auth(resolve));
    current = 'token-2';
    const second = await new Promise<{ token: string }>((resolve) => auth(resolve));
    expect(first).toEqual({ token: 'token-1' });
    expect(second).toEqual({ token: 'token-2' });
  });

  it('asks for its run rooms again after a reconnect', async () => {
    const { socket } = await load();
    socket.subscribeToJob('run-1');
    socket.subscribeToRevisionJob('report-1');
    expect(fake.emit).not.toHaveBeenCalled();
    fake.connected = true;
    fake.handlers.get('connect')?.();
    fake.handlers.get('connect')?.();
    expect(fake.emit.mock.calls).toEqual([
      ['subscribe:job', 'run-1'],
      ['subscribe:revision', 'report-1'],
      ['subscribe:job', 'run-1'],
      ['subscribe:revision', 'report-1'],
    ]);
  });

  it('retries after the server refuses a handshake that had no session yet', async () => {
    vi.useFakeTimers();
    try {
      const { socket } = await load();
      socket.getSocket();
      fake.handlers.get('connect_error')?.(new Error('unauthorized'));
      expect(fake.connect).not.toHaveBeenCalled();
      vi.advanceTimersByTime(2000);
      expect(fake.connect).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it('drops the old connection and its rooms when the signed-in user changes', async () => {
    const { socket } = await load();
    socket.subscribeToJob('run-of-previous-user');
    socket.reconnectSocketForSessionChange();
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
    expect(fake.connect).toHaveBeenCalledTimes(1);
    fake.connected = true;
    fake.handlers.get('connect')?.();
    expect(fake.emit).not.toHaveBeenCalled();
  });
});
