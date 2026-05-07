import http from 'http';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';

const mockAdmin = vi.hoisted(() => ({
  userIds: ['user_admin'] as string[],
}));

vi.mock('../config', () => ({
  config: {
    admin: mockAdmin,
  },
}));

vi.mock('../db/pool', () => ({
  query: vi.fn(),
}));

import authRouter from '../api/routes/auth';

async function listen(app: express.Application): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      resolve({
        baseUrl: `http://127.0.0.1:${addr.port}`,
        close: () =>
          new Promise<void>((res, rej) => {
            server.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}

describe('GET /auth/me', () => {
  let currentAuth: { userId: string | null; orgId?: string | null; sessionId?: string | null };

  const app = express();
  app.use((req, _res, next) => {
    Object.assign(req, { auth: currentAuth });
    next();
  });
  app.use('/auth', authRouter);

  beforeEach(() => {
    mockAdmin.userIds = ['user_admin'];
    currentAuth = { userId: null, orgId: null, sessionId: null };
  });

  it('returns 401 when unauthenticated', async () => {
    const { baseUrl, close } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/auth/me`);
      expect(res.status).toBe(401);
    } finally {
      await close();
    }
  });

  it('returns isAdmin false when user not in allowlist', async () => {
    currentAuth = { userId: 'user_plain', orgId: null, sessionId: null };
    const { baseUrl, close } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/auth/me`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { userId: string; isAdmin: boolean };
      expect(body).toEqual({ userId: 'user_plain', isAdmin: false });
    } finally {
      await close();
    }
  });

  it('returns isAdmin true when user is in ADMIN_USER_IDS', async () => {
    currentAuth = { userId: 'user_admin', orgId: null, sessionId: null };
    const { baseUrl, close } = await listen(app);
    try {
      const res = await fetch(`${baseUrl}/auth/me`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as { userId: string; isAdmin: boolean };
      expect(body).toEqual({ userId: 'user_admin', isAdmin: true });
    } finally {
      await close();
    }
  });
});
