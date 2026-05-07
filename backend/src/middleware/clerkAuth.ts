import type { NextFunction, Request, Response } from 'express';
import { verifyToken } from '@clerk/backend';
import { config } from '../config';
import { logger } from '../utils/logger';

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

function bearerOrAdminHeaderToken(req: Request): string | null {
  const x = req.header('x-admin-token')?.trim();
  if (x) return x;
  const raw = req.header('authorization') || '';
  if (raw.startsWith('Bearer ')) return raw.slice('Bearer '.length).trim() || null;
  return null;
}

/** Authorizes admin via either:
 *  1. Clerk JWT whose userId is in ADMIN_USER_IDS (preferred — audit trail), or
 *  2. Static ADMIN_RUNTIME_TOKEN (break-glass / automation only).
 *
 *  Returns 401 if the request has no usable identity for admin (no Clerk user and no valid token).
 *  Returns 403 if the request has a Clerk identity but is not allowlisted and no valid token.
 *
 *  Used on `/api/admin/*` without `requireAuth` so automation can use the token path without a session.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.auth?.userId && config.admin.userIds.includes(req.auth.userId)) {
    req.adminAuth = { method: 'clerk', userId: req.auth.userId };
    next();
    return;
  }

  const token = bearerOrAdminHeaderToken(req);
  if (config.admin.token && token === config.admin.token) {
    req.adminAuth = { method: 'token', userId: req.auth?.userId ?? null };
    logger.info('admin-auth-token-path', {
      endpoint: req.originalUrl,
      clerkUserId: req.auth?.userId ?? null,
    });
    next();
    return;
  }

  if (req.auth?.userId) {
    res.status(403).json({ error: 'Forbidden' });
    return;
  }
  res.status(401).json({ error: 'Unauthorized' });
}
