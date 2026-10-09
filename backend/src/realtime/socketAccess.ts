import type { Server as SocketIOServer, Socket } from 'socket.io';
import { verifyToken } from '@clerk/backend';
import { config } from '../config';
import { adminQuery } from '../db/pool';
import { buildOwnershipSql } from '../db/tenantScope';
import { isAllowlistedAdminUserId } from '../services/auth/adminAllowlist';
import { logger } from '../utils/logger';
import { jobRoom, revisionRoom, userRoom } from './rooms';

export interface SocketIdentity {
  userId: string;
  orgId: string | null;
}

/** Everything the access layer needs from the outside world (replaced in tests). */
export interface SocketAccessDeps {
  /** Resolve a session token to a signed-in user, or null when it is not valid. */
  verifySessionToken(token: string): Promise<SocketIdentity | null>;
  isAdmin(userId: string): boolean;
  /** True when `id` is a research run, ingestion job or report this user may see. */
  canAccessJob(id: string, identity: SocketIdentity): Promise<boolean>;
  /** True when `reportId` is a report this user may see. */
  canAccessReport(reportId: string, identity: SocketIdentity): Promise<boolean>;
}

const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isWellFormedId(value: unknown): value is string {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** Same Clerk session verification the HTTP API uses (`clerkAuthMiddleware`). */
async function verifyClerkSessionToken(token: string): Promise<SocketIdentity | null> {
  try {
    const payload = await verifyToken(token, {
      secretKey: config.clerk.secretKey,
    });
    if (typeof payload.sub !== 'string' || !payload.sub) return null;
    return {
      userId: payload.sub,
      orgId: typeof payload.org_id === 'string' ? payload.org_id : null,
    };
  } catch {
    return null;
  }
}

async function exists(sql: string, params: unknown[]): Promise<boolean> {
  const rows = await adminQuery<{ ok: number }>(sql, params);
  return rows.length > 0;
}

async function canAccessReportInDb(reportId: string, identity: SocketIdentity): Promise<boolean> {
  return exists(
    `SELECT 1 AS ok FROM reports WHERE id::text = $1 AND ${buildOwnershipSql('', 2, 3)} LIMIT 1`,
    [reportId, identity.userId, identity.orgId],
  );
}

async function canAccessJobInDb(id: string, identity: SocketIdentity): Promise<boolean> {
  const params = [id, identity.userId, identity.orgId];
  if (
    await exists(
      `SELECT 1 AS ok FROM research_runs WHERE id::text = $1 AND ${buildOwnershipSql('', 2, 3)} LIMIT 1`,
      params,
    )
  ) {
    return true;
  }
  if (
    await exists(
      `SELECT 1 AS ok FROM ingestion_jobs WHERE id::text = $1 AND user_id = $2 LIMIT 1`,
      [id, identity.userId],
    )
  ) {
    return true;
  }
  return canAccessReportInDb(id, identity);
}

export const defaultSocketAccessDeps: SocketAccessDeps = {
  verifySessionToken: verifyClerkSessionToken,
  isAdmin: isAllowlistedAdminUserId,
  canAccessJob: canAccessJobInDb,
  canAccessReport: canAccessReportInDb,
};

type SubscribeAck = (result: { ok: boolean }) => void;

function ackOf(candidate: unknown): SubscribeAck {
  return typeof candidate === 'function' ? (candidate as SubscribeAck) : () => undefined;
}

function handshakeToken(socket: Socket): string | null {
  const auth: unknown = socket.handshake.auth;
  if (auth && typeof auth === 'object') {
    const token = (auth as Record<string, unknown>).token;
    if (typeof token === 'string' && token.trim()) return token.trim();
  }
  const header = socket.handshake.headers.authorization;
  if (typeof header === 'string' && header.startsWith('Bearer ')) {
    const token = header.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return null;
}

function identityOf(socket: Socket): SocketIdentity | null {
  const data = socket.data as { identity?: SocketIdentity };
  return data.identity ?? null;
}

/**
 * Locks the Socket.IO server down:
 *  - a connection is refused unless it presents a valid session token;
 *  - an accepted socket is placed in its own user's room and nowhere else;
 *  - `subscribe:job` / `subscribe:revision` join a room only after the server
 *    confirms the object belongs to that user (or the user is an admin).
 */
export function attachSocketAccessControl(
  io: SocketIOServer,
  deps: SocketAccessDeps = defaultSocketAccessDeps,
): void {
  io.use((socket, next) => {
    const token = handshakeToken(socket);
    if (!token) {
      next(new Error('unauthorized'));
      return;
    }
    deps
      .verifySessionToken(token)
      .then((identity) => {
        if (!identity) {
          next(new Error('unauthorized'));
          return;
        }
        (socket.data as { identity?: SocketIdentity }).identity = identity;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    const identity = identityOf(socket);
    if (!identity) {
      socket.disconnect(true);
      return;
    }
    void socket.join(userRoom(identity.userId));

    const guardedJoin =
      (
        room: (id: string) => string,
        check: (id: string, who: SocketIdentity) => Promise<boolean>,
      ) =>
      (id: unknown, maybeAck?: unknown) => {
        const ack = ackOf(maybeAck);
        if (!isWellFormedId(id)) {
          ack({ ok: false });
          return;
        }
        const allowed = deps.isAdmin(identity.userId) ? Promise.resolve(true) : check(id, identity);
        allowed
          .then(async (ok) => {
            if (ok) await socket.join(room(id));
            ack({ ok });
          })
          .catch((err: unknown) => {
            logger.warn('socket_subscribe_check_failed', {
              error: err instanceof Error ? err.message : String(err),
            });
            ack({ ok: false });
          });
      };

    socket.on('subscribe:job', guardedJoin(jobRoom, deps.canAccessJob));
    socket.on('subscribe:revision', guardedJoin(revisionRoom, deps.canAccessReport));
    // Library updates reach a user through their own room, which the server
    // joined above. The event is kept so existing pages keep working.
    socket.on('subscribe:corpus', (...args: unknown[]) =>
      ackOf(args[args.length - 1])({ ok: true }),
    );
  });
}
