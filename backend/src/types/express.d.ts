import type { JwtPayload } from '@clerk/backend';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string | null;
        orgId: string | null;
        sessionId: string | null;
        token?: string;
        payload?: JwtPayload;
      };
      /** Set by `requireAdmin` when an admin route authorizes the request. */
      adminAuth?: { method: 'clerk' | 'token'; userId: string | null };
    }
  }
}

export {};
