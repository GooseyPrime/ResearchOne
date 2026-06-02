/**
 * One-shot legacy research ownership reassignment (admin, bypasses RLS).
 * Used by assignLegacyResearchOwnership.ts and deploy-runtime.sh.
 */
import { adminQuery } from '../db/pool';
import { logger } from '../utils/logger';

export const LEGACY_RESEARCH_ASSIGN_MARKER = 'p0_legacy_research_assigned_to_owner_v1';

export type LegacyAssignScope = 'all_existing' | 'unscoped_only';

export type LegacyAssignResult = {
  skipped: boolean;
  reason?: string;
  ownerUserId?: string;
  runsUpdated: number;
  reportsUpdated: number;
  reportExportsUpdated: number;
};

export async function hasDeployMarker(key: string): Promise<boolean> {
  try {
    const rows = await adminQuery<{ key: string }>(
      'SELECT key FROM app_deploy_markers WHERE key = $1 LIMIT 1',
      [key],
    );
    return rows.length > 0;
  } catch (err: unknown) {
    const code = (err as { code?: string })?.code;
    if (code === '42P01') return false;
    throw err;
  }
}

export async function resolveLegacyOwnerUserId(
  userIdEnv: string | undefined,
  emailEnv: string | undefined,
): Promise<string> {
  const userId = userIdEnv?.trim();
  if (userId) return userId;

  const email = (emailEnv?.trim() || 'brandon@intellmeai.com').toLowerCase();
  const rows = await adminQuery<{ id: string }>(
    `SELECT id FROM users WHERE lower(trim(email)) = $1 ORDER BY created_at ASC`,
    [email],
  );
  if (rows.length === 0) {
    throw new Error(
      `[legacy-research-owner] No users row for email ${JSON.stringify(email)}. ` +
        'Sign in once so Clerk sync creates users.id, or set LEGACY_OWNER_USER_ID to your Clerk user id.',
    );
  }
  if (rows.length > 1) {
    throw new Error(
      `[legacy-research-owner] Multiple users rows match email ${JSON.stringify(email)} — set LEGACY_OWNER_USER_ID explicitly.`,
    );
  }
  return rows[0].id;
}

async function countScopedUpdates(
  table: string,
  ownerUserId: string,
  scope: LegacyAssignScope,
): Promise<number> {
  const where =
    scope === 'unscoped_only'
      ? 'user_id IS NULL'
      : 'user_id IS DISTINCT FROM $1 OR user_id IS NULL';
  const params = scope === 'unscoped_only' ? [] : [ownerUserId];
  const rows = await adminQuery<{ c: number }>(
    `SELECT count(*)::int AS c FROM ${table} WHERE ${where}`,
    params,
  );
  return rows[0]?.c ?? 0;
}

export async function assignLegacyResearchOwnership(options: {
  ownerUserId: string;
  scope: LegacyAssignScope;
  markerKey?: string;
  dryRun?: boolean;
}): Promise<LegacyAssignResult> {
  const markerKey = options.markerKey ?? LEGACY_RESEARCH_ASSIGN_MARKER;
  const { ownerUserId, scope, dryRun } = options;

  if (await hasDeployMarker(markerKey)) {
    logger.info('[legacy-research-owner] Marker already applied — skipping', { markerKey });
    return { skipped: true, reason: 'marker_exists', runsUpdated: 0, reportsUpdated: 0, reportExportsUpdated: 0 };
  }

  const runsPending = await countScopedUpdates('research_runs', ownerUserId, scope);
  const reportsPending = await countScopedUpdates('reports', ownerUserId, scope);
  let exportsPending = 0;
  try {
    exportsPending = await countScopedUpdates('report_exports', ownerUserId, scope);
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== '42P01') throw err;
  }

  logger.info('[legacy-research-owner] Pending updates', {
    ownerUserId,
    scope,
    runsPending,
    reportsPending,
    reportExportsPending: exportsPending,
    dryRun: Boolean(dryRun),
  });

  if (dryRun) {
    return {
      skipped: false,
      ownerUserId,
      runsUpdated: runsPending,
      reportsUpdated: reportsPending,
      reportExportsUpdated: exportsPending,
    };
  }

  const runWhere =
    scope === 'unscoped_only'
      ? 'user_id IS NULL'
      : 'user_id IS DISTINCT FROM $1 OR user_id IS NULL';
  const runParams = scope === 'unscoped_only' ? [ownerUserId] : [ownerUserId];

  const runRows = await adminQuery<{ updated: number }>(
    `WITH u AS (
       UPDATE research_runs
       SET user_id = $1, org_id = NULL
       WHERE ${runWhere}
       RETURNING id
     )
     SELECT count(*)::int AS updated FROM u`,
    runParams,
  );
  const runsUpdated = runRows[0]?.updated ?? 0;

  const reportRows = await adminQuery<{ updated: number }>(
    `WITH u AS (
       UPDATE reports
       SET user_id = $1, org_id = NULL
       WHERE ${scope === 'unscoped_only' ? 'user_id IS NULL' : 'user_id IS DISTINCT FROM $1 OR user_id IS NULL'}
       RETURNING id
     )
     SELECT count(*)::int AS updated FROM u`,
    scope === 'unscoped_only' ? [ownerUserId] : [ownerUserId],
  );
  const reportsUpdated = reportRows[0]?.updated ?? 0;

  let reportExportsUpdated = 0;
  try {
    const exportRows = await adminQuery<{ updated: number }>(
      `WITH u AS (
         UPDATE report_exports
         SET user_id = $1
         WHERE ${scope === 'unscoped_only' ? 'user_id IS NULL' : 'user_id IS DISTINCT FROM $1 OR user_id IS NULL'}
         RETURNING id
       )
       SELECT count(*)::int AS updated FROM u`,
      scope === 'unscoped_only' ? [ownerUserId] : [ownerUserId],
    );
    reportExportsUpdated = exportRows[0]?.updated ?? 0;
  } catch (err: unknown) {
    if ((err as { code?: string })?.code !== '42P01') throw err;
  }

  await adminQuery(
    `INSERT INTO app_deploy_markers (key, metadata)
     VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO NOTHING`,
    [
      markerKey,
      JSON.stringify({
        ownerUserId,
        scope,
        runsUpdated,
        reportsUpdated,
        reportExportsUpdated,
      }),
    ],
  );

  logger.info('[legacy-research-owner] Complete', {
    ownerUserId,
    scope,
    runsUpdated,
    reportsUpdated,
    reportExportsUpdated,
  });

  return {
    skipped: false,
    ownerUserId,
    runsUpdated,
    reportsUpdated,
    reportExportsUpdated,
  };
}
