import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { rlsContextMiddleware } from '../middleware/rlsContext';
import { rlsStore } from '../db/pool';

describe('rlsContextMiddleware', () => {
  it('creates empty auth object when absent', () => {
    const req = {} as Request;
    const nextCalls: number[] = [];

    rlsContextMiddleware(req, {} as Response, () => {
      nextCalls.push(1);
    });

    expect(req.auth).toEqual({ userId: null, orgId: null, sessionId: null });
    expect(nextCalls).toHaveLength(1);
  });

  it('stores userId and orgId in AsyncLocalStorage during next()', () => {
    const req = {
      auth: { userId: 'user_abc', orgId: 'org_xyz', sessionId: 'sess_1' },
    } as unknown as Request;

    let capturedCtx: { userId: string | null; orgId: string | null } | undefined;
    rlsContextMiddleware(req, {} as Response, () => {
      capturedCtx = rlsStore.getStore();
    });

    expect(capturedCtx).toEqual({ userId: 'user_abc', orgId: 'org_xyz' });
  });

  it('stores null userId/orgId when auth has no userId', () => {
    const req = {
      auth: { userId: null, orgId: null, sessionId: null },
    } as unknown as Request;

    let capturedCtx: { userId: string | null; orgId: string | null } | undefined;
    rlsContextMiddleware(req, {} as Response, () => {
      capturedCtx = rlsStore.getStore();
    });

    expect(capturedCtx).toEqual({ userId: null, orgId: null });
  });

  it('context is not visible outside the middleware scope', () => {
    const req = {
      auth: { userId: 'user_inside', orgId: null, sessionId: null },
    } as unknown as Request;
    const nextCalls: number[] = [];

    rlsContextMiddleware(req, {} as Response, () => {
      nextCalls.push(1);
    });

    expect(nextCalls).toHaveLength(1);
    expect(rlsStore.getStore()).toBeUndefined();
  });

  it('concurrent contexts are isolated between requests', () => {
    const captured: Array<{ userId: string | null; orgId: string | null } | undefined> = [];

    const req1 = { auth: { userId: 'user_1', orgId: null, sessionId: null } } as unknown as Request;
    const req2 = { auth: { userId: 'user_2', orgId: 'org_2', sessionId: null } } as unknown as Request;

    rlsContextMiddleware(req1, {} as Response, () => {
      captured.push(rlsStore.getStore());
      rlsContextMiddleware(req2, {} as Response, () => {
        captured.push(rlsStore.getStore());
      });
      captured.push(rlsStore.getStore());
    });

    expect(captured[0]).toEqual({ userId: 'user_1', orgId: null });
    expect(captured[1]).toEqual({ userId: 'user_2', orgId: 'org_2' });
    expect(captured[2]).toEqual({ userId: 'user_1', orgId: null });
  });
});
