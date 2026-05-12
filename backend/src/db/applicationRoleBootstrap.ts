/**
 * Privileged bootstrap for Postgres role `application_role` + grants (migration 021 intent).
 * Used when migration 021 no-ops because the migration user lacks CREATEROLE.
 *
 * @see backend/src/db/migrations/021_rls_setup.sql — keep grant/revoke logic aligned.
 */

import { Client } from 'pg';

export const APPLICATION_ROLE_NAME = 'application_role';

/** Unquoted SQL identifier: letters, digits, underscore; first char not a digit. */
const SAFE_IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;

/**
 * Derives the runtime DB login role name from DATABASE_URL (preferred) or DB_USER.
 * Used for `GRANT application_role TO <runtime_login>`.
 */
export function deriveRuntimeDbLoginRoleFromEnv(env: NodeJS.ProcessEnv): string {
  const urlStr = env.DATABASE_URL?.trim();
  if (urlStr) {
    let u: URL;
    try {
      u = new URL(urlStr);
    } catch {
      throw new Error('DATABASE_URL is set but is not a valid URL');
    }
    const user = decodeURIComponent(u.username);
    if (!user) {
      throw new Error('DATABASE_URL must include a username (the runtime DB login role)');
    }
    assertSafePostgresIdentifier(user, 'DATABASE_URL username');
    return user;
  }

  const du = env.DB_USER?.trim();
  if (!du) {
    throw new Error(
      'Missing runtime DB login: set DATABASE_URL (with username) or DB_USER so the bootstrap can GRANT application_role to that role',
    );
  }
  assertSafePostgresIdentifier(du, 'DB_USER');
  return du;
}

export function assertSafePostgresIdentifier(name: string, label: string): void {
  if (!SAFE_IDENTIFIER.test(name)) {
    throw new Error(
      `${label} "${name}" is not a supported unquoted Postgres identifier (use letters, digits, underscore only; first character must be a letter or underscore).`,
    );
  }
}

/**
 * DDL for default privileges on objects created by the runtime login (migration user).
 * Migration 021 runs as `current_user`; privileged bootstrap runs as admin — without
 * `FOR ROLE <runtimeLogin>` new tables/sequences would not inherit grants to application_role.
 * `runtimeLogin` must pass {@link assertSafePostgresIdentifier} before calling.
 */
export function formatDefaultPrivilegesTableGrant(runtimeLogin: string): string {
  assertSafePostgresIdentifier(runtimeLogin, 'runtime login');
  return `ALTER DEFAULT PRIVILEGES FOR ROLE ${runtimeLogin} IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${APPLICATION_ROLE_NAME}`;
}

export function formatDefaultPrivilegesSequenceGrant(runtimeLogin: string): string {
  assertSafePostgresIdentifier(runtimeLogin, 'runtime login');
  return `ALTER DEFAULT PRIVILEGES FOR ROLE ${runtimeLogin} IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO ${APPLICATION_ROLE_NAME}`;
}

export function getDatabaseAdminUrlFromEnv(env: NodeJS.ProcessEnv): string | undefined {
  const v = env.DATABASE_ADMIN_URL?.trim();
  return v || undefined;
}

export function resolveRuntimeDatabaseUrl(env: NodeJS.ProcessEnv): string {
  const urlStr = env.DATABASE_URL?.trim();
  if (urlStr) return urlStr;

  const user = deriveRuntimeDbLoginRoleFromEnv(env);
  const password = env.DB_PASSWORD ?? '';
  const host = (env.DB_HOST || 'localhost').trim();
  const port = (env.DB_PORT || '5432').trim();
  const name = (env.DB_NAME || 'researchone').trim();
  return `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@${host}:${port}/${encodeURIComponent(name)}`;
}

export async function applicationRoleExists(client: Client): Promise<boolean> {
  const { rows } = await client.query<{ exists: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = $1) AS exists`,
    [APPLICATION_ROLE_NAME],
  );
  return Boolean(rows[0]?.exists);
}

/**
 * Returns true when the current session can `SET ROLE application_role` (membership OK).
 */
export async function runtimeCanAssumeApplicationRole(client: Client): Promise<boolean> {
  const exists = await applicationRoleExists(client);
  if (!exists) return false;
  try {
    await client.query('BEGIN');
    await client.query(`SET ROLE ${APPLICATION_ROLE_NAME}`);
    await client.query('RESET ROLE');
    await client.query('COMMIT');
    return true;
  } catch {
    try {
      await client.query('ROLLBACK');
    } catch {
      // ignore
    }
    try {
      await client.query('RESET ROLE');
    } catch {
      // ignore
    }
    return false;
  }
}

/**
 * Applies migration-021-equivalent DDL using a privileged connection. Idempotent.
 */
export async function applyApplicationRoleBootstrapAsAdmin(
  adminClient: Client,
  runtimeLogin: string,
): Promise<void> {
  await adminClient.query('BEGIN');
  try {
    await adminClient.query(`
      DO $do$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${APPLICATION_ROLE_NAME}') THEN
          CREATE ROLE ${APPLICATION_ROLE_NAME} NOINHERIT NOLOGIN;
        END IF;
      END
      $do$;
    `);

    const grantMember = await adminClient.query<{ q: string }>(
      `SELECT format('GRANT ${APPLICATION_ROLE_NAME} TO %I', $1::text) AS q`,
      [runtimeLogin],
    );
    const q = grantMember.rows[0]?.q;
    if (!q) throw new Error('internal: empty GRANT statement');
    try {
      await adminClient.query(q);
    } catch (e: unknown) {
      const err = e as { code?: string; message?: string };
      const dup =
        err?.code === '42710' || /already a member of role/i.test(String(err?.message || ''));
      if (!dup) throw e;
    }

    await adminClient.query(`GRANT USAGE ON SCHEMA public TO ${APPLICATION_ROLE_NAME}`);
    await adminClient.query(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APPLICATION_ROLE_NAME}`,
    );
    await adminClient.query(formatDefaultPrivilegesTableGrant(runtimeLogin));

    await adminClient.query(
      `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${APPLICATION_ROLE_NAME}`,
    );
    await adminClient.query(formatDefaultPrivilegesSequenceGrant(runtimeLogin));

    await adminClient.query(`REVOKE CREATE ON SCHEMA public FROM ${APPLICATION_ROLE_NAME}`);

    for (const table of ['wallet_ledger', 'stripe_webhook_events'] as const) {
      try {
        await adminClient.query(
          `REVOKE UPDATE, DELETE ON ${table} FROM ${APPLICATION_ROLE_NAME}`,
        );
      } catch (e: unknown) {
        const err = e as { code?: string };
        if (err?.code !== '42P01') throw e;
      }
    }

    try {
      await adminClient.query(
        `REVOKE INSERT, UPDATE, DELETE ON tier_addons FROM ${APPLICATION_ROLE_NAME}`,
      );
    } catch (e: unknown) {
      const err = e as { code?: string };
      if (err?.code !== '42P01') throw e;
    }

    await adminClient.query('COMMIT');
  } catch (e) {
    try {
      await adminClient.query('ROLLBACK');
    } catch {
      // ignore
    }
    throw e;
  }
}

export const MISSING_ADMIN_URL_MESSAGE = [
  'Postgres role application_role is missing (or the runtime login cannot SET ROLE to it).',
  'Migration 021 may have no-oped without CREATEROLE on the migration user.',
  'Fix: set DATABASE_ADMIN_URL to a privileged Postgres connection string (separate from DATABASE_URL),',
  'then run: cd backend && npm run bootstrap:application-role',
  'See docs/RUNBOOKS/application-role-bootstrap.md',
].join(' ');
