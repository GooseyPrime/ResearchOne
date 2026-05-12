/**
 * CLI: ensure `application_role` exists and the runtime login can SET ROLE to it.
 * Loads backend/.env from repo root (same layout as migrate.ts via cwd on Emma).
 *
 * Env:
 * - DATABASE_URL or DB_* — runtime connection + login name derivation
 * - DATABASE_ADMIN_URL — privileged connection (CREATE ROLE, GRANT … ON ALL TABLES)
 * - DATABASE_ADMIN_URL_B64 — optional; base64-encoded DATABASE_ADMIN_URL (used by CI SSH inject)
 */

import path from 'path';
import dotenv from 'dotenv';
import { Client } from 'pg';
import { getRepoRoot } from '../bootstrap/loadEnv';
import {
  applyApplicationRoleBootstrapAsAdmin,
  deriveRuntimeDbLoginRoleFromEnv,
  getDatabaseAdminUrlFromEnv,
  MISSING_ADMIN_URL_MESSAGE,
  resolveRuntimeDatabaseUrl,
  runtimeCanAssumeApplicationRole,
} from './applicationRoleBootstrap';

function loadBackendDotenv(): void {
  const repoRoot = getRepoRoot();
  const envPath = path.join(repoRoot, 'backend', '.env');
  dotenv.config({ path: envPath });
}

function decodeInjectedAdminUrl(): void {
  const b64 = process.env.DATABASE_ADMIN_URL_B64?.trim();
  if (!b64) return;
  try {
    process.env.DATABASE_ADMIN_URL = Buffer.from(b64, 'base64').toString('utf8');
  } catch (e) {
    console.error('[bootstrap-application-role] DATABASE_ADMIN_URL_B64 is not valid base64');
    throw e;
  }
  delete process.env.DATABASE_ADMIN_URL_B64;
}

async function main(): Promise<void> {
  loadBackendDotenv();
  decodeInjectedAdminUrl();

  const runtimeUrl = resolveRuntimeDatabaseUrl(process.env);
  const runtimeLogin = deriveRuntimeDbLoginRoleFromEnv(process.env);

  const runtimeClient = new Client({ connectionString: runtimeUrl });
  await runtimeClient.connect();
  try {
    if (await runtimeCanAssumeApplicationRole(runtimeClient)) {
      console.info(
        `[bootstrap-application-role] OK: role ${JSON.stringify('application_role')} exists and runtime login ${JSON.stringify(runtimeLogin)} can SET ROLE to it.`,
      );
      return;
    }
  } finally {
    await runtimeClient.end().catch(() => {});
  }

  const adminUrl = getDatabaseAdminUrlFromEnv(process.env);
  if (!adminUrl) {
    console.error(`[bootstrap-application-role] ${MISSING_ADMIN_URL_MESSAGE}`);
    process.exit(1);
  }

  const adminClient = new Client({ connectionString: adminUrl });
  await adminClient.connect();
  try {
    console.info(
      `[bootstrap-application-role] Applying privileged bootstrap for runtime login ${JSON.stringify(runtimeLogin)} …`,
    );
    await applyApplicationRoleBootstrapAsAdmin(adminClient, runtimeLogin);
  } finally {
    await adminClient.end().catch(() => {});
  }

  const verify = new Client({ connectionString: runtimeUrl });
  await verify.connect();
  try {
    if (!(await runtimeCanAssumeApplicationRole(verify))) {
      console.error(
        '[bootstrap-application-role] After bootstrap, runtime login still cannot SET ROLE to application_role — check DATABASE_URL login matches the grantee.',
      );
      process.exit(1);
    }
  } finally {
    await verify.end().catch(() => {});
  }

  console.info('[bootstrap-application-role] OK: bootstrap applied and verified.');
}

main().catch((err) => {
  console.error('[bootstrap-application-role] failed:', err);
  process.exit(1);
});
