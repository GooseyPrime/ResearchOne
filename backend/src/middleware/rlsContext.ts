import type { NextFunction, Request, Response } from 'express';

export function rlsContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // WO-C scaffolding only — real Postgres RLS policies + tenant-scoped queries land in WO-K.
  if (!req.auth) {
    req.auth = { userId: null, orgId: null, sessionId: null };
  }
  next();
}
