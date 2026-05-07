import type { NextFunction, Request, Response } from 'express';
import { getPool } from '../db/pool';
import { logger } from '../utils/logger';

/**
 * Sets PostgreSQL session variables (app.user_id, app.org_id) for RLS policy evaluation.
 * These are read by the USING clauses in migration 022_rls_policies.sql.
 *
 * The variables are set on the next connection the pool hands out for this request.
 * Since Express is single-threaded per request, the SET LOCAL in the pool's connect
 * callback ensures the correct user context.
 *
 * When no auth is present, the variables remain unset (current_setting returns NULL
 * with the `true` missing_ok parameter), which means RLS policies return zero rows.
 */
export function rlsContextMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.auth) {
    req.auth = { userId: null, orgId: null, sessionId: null };
  }

  const userId = req.auth.userId;
  const orgId = req.auth.orgId;

  if (userId) {
    const pool = getPool();
    const origConnect = pool.connect.bind(pool);

    const wrappedConnect = async () => {
      const client = await origConnect();
      try {
        if (userId) {
          await client.query(`SET LOCAL app.user_id = '${userId.replace(/'/g, "''")}'`);
        }
        if (orgId) {
          await client.query(`SET LOCAL app.org_id = '${orgId.replace(/'/g, "''")}'`);
        }
      } catch (err) {
        logger.warn('Failed to set RLS session variables (migration may not be applied)', {
          userId,
          error: err instanceof Error ? err.message : 'Unknown',
        });
      }
      return client;
    };

    pool.connect = wrappedConnect as typeof pool.connect;

    const cleanup = () => {
      pool.connect = origConnect;
    };

    _res.on('finish', cleanup);
    _res.on('close', cleanup);
  }

  next();
}
