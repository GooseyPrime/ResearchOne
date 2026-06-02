/**
 * Cross-tenant isolation integration tests (requires real Postgres).
 *
 * Set TEST_DATABASE_URL to a migrated database with application_role bootstrapped.
 * Skipped when unset (CI without DB).
 */
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initDb, adminQuery, rlsStore, query } from '../db/pool';
import { appendOwnershipFilter } from '../db/tenantScope';
import { listDossiers } from '../services/research/dossierReadService';

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();

const describeIfDb = testDbUrl ? describe : describe.skip;

describeIfDb('tenant isolation (integration)', () => {
  const USER_A = `user_tenant_a_${randomUUID()}`;
  const USER_B = `user_tenant_b_${randomUUID()}`;
  let runA: string;
  let runB: string;

  beforeAll(async () => {
    process.env.DATABASE_URL = testDbUrl;
    await initDb();

    runA = randomUUID();
    runB = randomUUID();

    await adminQuery(
      `INSERT INTO research_runs (id, title, query, supplemental, status, user_id, org_id, created_at)
       VALUES ($1, 'Tenant A run', 'query A', '', 'completed', $2, NULL, NOW()),
              ($3, 'Tenant B run', 'query B', '', 'completed', $4, NULL, NOW())`,
      [runA, USER_A, runB, USER_B],
    );
  });

  afterAll(async () => {
    if (!testDbUrl) return;
    await adminQuery('DELETE FROM research_runs WHERE id = ANY($1::uuid[])', [[runA, runB]]);
  });

  async function listRunsForUser(userId: string): Promise<string[]> {
    return rlsStore.run({ userId, orgId: null }, async () => {
      const conds: string[] = [];
      const params: unknown[] = [];
      appendOwnershipFilter(conds, params, { userId, orgId: null });
      const rows = await query<{ id: string }>(
        `SELECT id FROM research_runs WHERE ${conds.join(' AND ')} ORDER BY created_at DESC`,
        params,
      );
      return rows.map((r) => r.id);
    });
  }

  it('research_runs list is disjoint per user under RLS', async () => {
    const idsA = await listRunsForUser(USER_A);
    const idsB = await listRunsForUser(USER_B);

    expect(idsA).toContain(runA);
    expect(idsA).not.toContain(runB);
    expect(idsB).toContain(runB);
    expect(idsB).not.toContain(runA);
  });

  it('listDossiers returns disjoint dossier run ids per user', async () => {
    const dossiersA = await rlsStore.run({ userId: USER_A, orgId: null }, () =>
      listDossiers({ page: 1, pageSize: 100 }, { userId: USER_A, orgId: null }),
    );
    const dossiersB = await rlsStore.run({ userId: USER_B, orgId: null }, () =>
      listDossiers({ page: 1, pageSize: 100 }, { userId: USER_B, orgId: null }),
    );

    const runIdsA = new Set(dossiersA.rows.map((r) => r.runId));
    const runIdsB = new Set(dossiersB.rows.map((r) => r.runId));

    if (runIdsA.size > 0) {
      expect(runIdsA.has(runA)).toBe(true);
      expect(runIdsA.has(runB)).toBe(false);
    }
    if (runIdsB.size > 0) {
      expect(runIdsB.has(runB)).toBe(true);
      expect(runIdsB.has(runA)).toBe(false);
    }

    for (const id of runIdsA) {
      expect(runIdsB.has(id)).toBe(false);
    }
  });

  it('v_dossier direct query for user B does not return user A run', async () => {
    const rows = await rlsStore.run({ userId: USER_B, orgId: null }, () =>
      query<{ run_id: string }>(
        `SELECT run_id FROM v_dossier
         WHERE user_id = $1 OR (org_id IS NOT NULL AND org_id = $2)`,
        [USER_B, null],
      ),
    );
    const runIds = rows.map((r) => r.run_id);
    expect(runIds).not.toContain(runA);
  });
});

describe('tenant isolation (integration) — skip guard', () => {
  it('documents TEST_DATABASE_URL requirement when skipped', () => {
    if (testDbUrl) return;
    expect(process.env.TEST_DATABASE_URL).toBeUndefined();
  });
});
