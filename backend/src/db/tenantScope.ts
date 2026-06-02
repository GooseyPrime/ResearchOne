import { logger } from '../utils/logger';

/** Stable API error code when user-scoped columns or RLS are unavailable (fail closed). */
export const TENANT_ISOLATION_UNAVAILABLE = 'tenant_isolation_unavailable';

export const TENANT_ISOLATION_MESSAGE =
  'Tenant isolation is temporarily unavailable. Apply database migrations and bootstrap application_role (see docs/RUNBOOKS/application-role-bootstrap.md).';

export class TenantIsolationUnavailableError extends Error {
  readonly code = TENANT_ISOLATION_UNAVAILABLE;
  readonly statusCode = 503;

  constructor(message = TENANT_ISOLATION_MESSAGE) {
    super(message);
    this.name = 'TenantIsolationUnavailableError';
  }
}

export function isUserScopeColumnMissing(err: unknown): boolean {
  return (err as { code?: string })?.code === '42703';
}

/**
 * Re-throw as 503 when deploy skew removes user_id/org_id columns.
 * Never fall back to unscoped reads (cross-tenant exposure).
 */
export function rejectUnscopedReadOnScopeError(err: unknown, route: string): never {
  if (isUserScopeColumnMissing(err)) {
    logger.error('tenant_isolation_unavailable', {
      route,
      reason: 'user_scope_columns_missing',
      pgCode: '42703',
    });
    throw new TenantIsolationUnavailableError();
  }
  throw err;
}

/**
 * SQL ownership predicate for authenticated users (no legacy NULL rows).
 * @param alias Table alias including trailing dot, or empty for unqualified columns.
 */
export function buildOwnershipSql(
  alias: string,
  userParam: number,
  orgParam: number,
): string {
  const p = alias ? `${alias}.` : '';
  return `(${p}user_id = $${userParam} OR (${p}org_id IS NOT NULL AND ${p}org_id = $${orgParam}))`;
}

/** Tables scoped by user_id only (e.g. ingestion_jobs, atlas_exports). */
export function buildUserOnlyOwnershipSql(alias: string, userParam: number): string {
  const p = alias ? `${alias}.` : '';
  return `${p}user_id = $${userParam}`;
}

export type TenantAuth = { userId: string | null; orgId: string | null };

/**
 * Append v_dossier (or research_runs) ownership filters for list/detail queries.
 * Returns next param index after pushing userId and orgId.
 */
export function appendOwnershipFilter(
  conds: string[],
  params: unknown[],
  auth: TenantAuth,
  alias = '',
): void {
  const userIdx = params.length + 1;
  params.push(auth.userId);
  const orgIdx = params.length + 1;
  params.push(auth.orgId);
  conds.push(buildOwnershipSql(alias, userIdx, orgIdx));
}
