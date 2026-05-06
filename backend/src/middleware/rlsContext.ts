import type { NextFunction, Request, Response } from 'express';

export function rlsContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  // Work Order C scaffolding: auth context propagation for follow-up RLS enforcement.
  if (!req.auth) {
    req.auth = { userId: null, orgId: null, sessionId: null };
  }
  next();
}
