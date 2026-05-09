/**
 * One-shot backfill script: copies user_id and org_id from research_runs
 * into reports (and any other tables that can derive ownership via run_id).
 *
 * Run manually after migration 029 has been applied:
 *   npx tsx backend/src/scripts/backfillUserScopes.ts
 *
 * Uses adminQuery (bypasses RLS) since the rows being backfilled have
 * NULL user_id and would be invisible under row-level security.
 */

import { loadEnv } from '../bootstrap/loadEnv';
import { initDb, adminQuery } from '../db/pool';
import { logger } from '../utils/logger';

async function backfillReports(): Promise<number> {
  const rows = await adminQuery<{ updated: number }>(
    `WITH backfilled AS (
       UPDATE reports r
       SET user_id = rr.user_id,
           org_id  = rr.org_id
       FROM research_runs rr
       WHERE r.run_id = rr.id
         AND r.user_id IS NULL
         AND rr.user_id IS NOT NULL
       RETURNING r.id
     )
     SELECT count(*)::int AS updated FROM backfilled`
  );
  return rows[0]?.updated ?? 0;
}

async function main(): Promise<void> {
  loadEnv();
  await initDb();

  logger.info('[backfill-user-scopes] Starting backfill…');

  const reportsUpdated = await backfillReports();
  logger.info(`[backfill-user-scopes] reports: ${reportsUpdated} rows backfilled (user_id + org_id copied from research_runs)`);

  logger.info(
    '[backfill-user-scopes] ingestion_jobs: no derivable user_id from existing data — rows will stay NULL. ' +
    'Manual resolution required if scoped ingestion tracking is needed.'
  );
  logger.info(
    '[backfill-user-scopes] atlas_exports: no derivable user_id from existing data — rows will stay NULL. ' +
    'Manual resolution required if scoped export tracking is needed.'
  );

  logger.info('[backfill-user-scopes] Backfill complete.');
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error('[backfill-user-scopes] Fatal error:', err);
    process.exit(1);
  });
