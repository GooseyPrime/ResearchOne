import { describe, expect, it } from 'vitest';
import type { Request, Response } from 'express';
import { rlsContextMiddleware } from '../middleware/rlsContext';

describe('rlsContextMiddleware (stub — full RLS in WO-K)', () => {
  it('creates empty auth object when absent', () => {
    const req = {} as Request;
    const nextCalls: number[] = [];

    rlsContextMiddleware(req, {} as Response, () => {
      nextCalls.push(1);
    });

    expect(req.auth).toEqual({ userId: null, orgId: null, sessionId: null });
    expect(nextCalls).toHaveLength(1);
  });

  it.todo('sets app.user_id Postgres GUC when req.auth.userId present (blocked on WO-K)');
});
