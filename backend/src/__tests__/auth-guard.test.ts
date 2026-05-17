import { describe, expect, it, vi } from 'vitest';
import type { Request, Response } from 'express';

import { requireAuth } from '../middleware/clerkAuth';
import { rlsContextMiddleware } from '../middleware/rlsContext';
import { rlsStore } from '../db/pool';

describe('requireAuth guard (JWT gate on API routers)', () => {
  it('rejects unauthenticated request with 401 before handler work', () => {
    const req = { auth: { userId: null } } as unknown as Request;
    const res = { status: vi.fn(() => res), json: vi.fn() } as unknown as Response;
    const next = vi.fn();

    requireAuth(req, res, next);

    expect((res.status as unknown as ReturnType<typeof vi.fn>)).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('Postgres RLS context propagation', () => {
  it('authenticated user has userId propagated to AsyncLocalStorage for RLS', () => {
    const req = {
      auth: { userId: 'user_rls_test', orgId: 'org_rls', sessionId: 's1' },
    } as unknown as Request;

    let storeSnapshot: { userId: string | null; orgId: string | null } | undefined;
    rlsContextMiddleware(req, {} as Response, () => {
      storeSnapshot = rlsStore.getStore();
    });

    expect(storeSnapshot).toEqual({ userId: 'user_rls_test', orgId: 'org_rls' });
  });

  it('unauthenticated request gets null userId in store (RLS sees zero rows)', () => {
    const req = {} as Request;

    let storeSnapshot: { userId: string | null; orgId: string | null } | undefined;
    rlsContextMiddleware(req, {} as Response, () => {
      storeSnapshot = rlsStore.getStore();
    });

    expect(storeSnapshot).toEqual({ userId: null, orgId: null });
  });

  it('RLS store is scoped to request — not visible after middleware returns', () => {
    const req = {
      auth: { userId: 'user_scope', orgId: null, sessionId: null },
    } as unknown as Request;
    const nextCalls: number[] = [];

    rlsContextMiddleware(req, {} as Response, () => {
      nextCalls.push(1);
    });

    expect(nextCalls).toHaveLength(1);
    expect(rlsStore.getStore()).toBeUndefined();
  });
});
