import type { NextFunction, Request, Response } from 'express';
import { rlsStore } from '../db/pool';

/**
 * RLS context middleware — stores userId/orgId in AsyncLocalStorage.
 *
 * The DB pool reads from this store inside transactions to SET ROLE
 * and set_config() for Postgres RLS policy evaluation. No monkey-patching
 * of the pool; no race conditions between concurrent requests.
 */
export function rlsContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    req.auth = { userId: null, orgId: null, sessionId: null };
  }

  const ctx = {
    userId: req.auth.userId ?? null,
    orgId: req.auth.orgId ?? null,
  };

  rlsStore.run(ctx, () => next());
}
