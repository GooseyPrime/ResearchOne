import { Router, type NextFunction, type Request, type Response } from 'express';
import { query } from '../db/pool';
import { buildOwnershipSql, rejectUnscopedReadOnScopeError } from '../db/tenantScope';

/**
 * Ownership checks that run before the route handlers they protect.
 *
 * These routes change or act on a report or run identified only by the id in
 * the address. Each is answered with 404 — the same answer as an id that does
 * not exist — unless the signed-in user owns the object, before the handler
 * writes, fetches or announces anything for it.
 *
 * Mounted in app.ts ahead of the routers, on both the `/api` prefix and the
 * bare compatibility prefix.
 */

type OwnedTable = 'reports' | 'research_runs';

function requireOwned(table: OwnedTable, param: string, notFound: string) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = req.auth?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }
      const id = String(req.params[param] ?? '');
      let rows: unknown[];
      try {
        rows = await query(
          `SELECT 1 FROM ${table} WHERE id::text = $1::text AND ${buildOwnershipSql('', 2, 3)} LIMIT 1`,
          [id, userId, req.auth?.orgId ?? null],
        );
      } catch (scopeErr) {
        rejectUnscopedReadOnScopeError(scopeErr, `ownership guard ${table}`);
      }
      if (rows.length === 0) {
        res.status(404).json({ error: notFound });
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/** Guards for routes mounted under `/reports`. */
export const reportOwnershipGuards = Router();
reportOwnershipGuards.post('/:id/revisions', requireOwned('reports', 'id', 'Report not found'));
reportOwnershipGuards.post(
  '/:reportId/monitors',
  requireOwned('reports', 'reportId', 'Report not found'),
);

/** Guards for routes mounted under `/research`. */
export const researchOwnershipGuards = Router();
researchOwnershipGuards.post(
  '/:id/retry-from-failure',
  requireOwned('research_runs', 'id', 'Research run not found'),
);
