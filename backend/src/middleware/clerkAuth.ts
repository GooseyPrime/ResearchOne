import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '@clerk/backend';
import { config } from '../config';

function bearerToken(req: Request): string | null {
  const raw = req.header('authorization') || '';
  if (!raw.startsWith('Bearer ')) return null;
  const token = raw.slice('Bearer '.length).trim();
  return token || null;
}

export async function clerkAuthMiddleware(req: Request, _res: Response, next: NextFunction) {
  const token = bearerToken(req);
  if (!token) {
    req.auth = { userId: null, orgId: null, sessionId: null };
    next();
    return;
  }

  try {
    const payload = await verifyToken(token, {
      secretKey: config.clerk.secretKey,
    });

    req.auth = {
      userId: typeof payload.sub === 'string' ? payload.sub : null,
      orgId: typeof payload.org_id === 'string' ? payload.org_id : null,
      sessionId: typeof payload.sid === 'string' ? payload.sid : null,
      token,
      payload,
    };
  } catch {
    req.auth = { userId: null, orgId: null, sessionId: null };
  }

  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.auth?.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}
