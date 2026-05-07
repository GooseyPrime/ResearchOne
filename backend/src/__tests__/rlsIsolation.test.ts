import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('RLS isolation', () => {
  describe('migration 021 — role and grants', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/021_rls_setup.sql'),
      'utf8'
    );

    it('creates application_role with NOINHERIT NOLOGIN', () => {
      expect(sql).toContain('application_role');
      expect(sql).toContain('NOINHERIT');
      expect(sql).toContain('NOLOGIN');
    });

    it('grants SET ROLE to current_user', () => {
      expect(sql).toContain('GRANT application_role TO');
    });

    it('grants SELECT/INSERT/UPDATE/DELETE on all tables', () => {
      expect(sql).toContain('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES');
    });

    it('revokes UPDATE/DELETE on wallet_ledger (append-only)', () => {
      expect(sql).toContain('REVOKE UPDATE, DELETE ON wallet_ledger FROM application_role');
    });

    it('revokes UPDATE/DELETE on stripe_webhook_events (append-only)', () => {
      expect(sql).toContain('REVOKE UPDATE, DELETE ON stripe_webhook_events FROM application_role');
    });

    it('makes tier_addons read-only for application_role', () => {
      expect(sql).toContain('REVOKE INSERT, UPDATE, DELETE ON tier_addons FROM application_role');
    });

    it('grants sequence usage for SERIAL/BIGSERIAL columns', () => {
      expect(sql).toContain('GRANT USAGE, SELECT ON ALL SEQUENCES');
    });

    it('revokes CREATE on schema public from application_role', () => {
      expect(sql).toContain('REVOKE CREATE ON SCHEMA public FROM application_role');
    });
  });

  describe('migration 022 — RLS policies', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/022_rls_policies.sql'),
      'utf8'
    );

    const tablesWithRls = [
      'user_wallets',
      'wallet_ledger',
      'wallet_holds',
      'user_subscriptions',
      'user_tiers',
      'byok_keys',
    ];

    for (const table of tablesWithRls) {
      it(`enables RLS on ${table}`, () => {
        expect(sql).toContain(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`);
      });

      it(`creates policy on ${table} using app.user_id`, () => {
        expect(sql).toContain(`CREATE POLICY ${table}_user_isolation ON ${table}`);
        expect(sql).toContain("current_setting('app.user_id', true)");
      });
    }

    it('user_tiers policy includes org_id check for team shared access', () => {
      expect(sql).toContain("current_setting('app.org_id', true)");
      expect(sql).toContain('org_id IS NOT NULL');
    });

    it('does NOT enroll tier_addons in RLS', () => {
      expect(sql).not.toContain('ALTER TABLE tier_addons ENABLE ROW LEVEL SECURITY');
    });

    it('policies target application_role', () => {
      const policyMatches = sql.match(/TO application_role/g);
      expect(policyMatches).not.toBeNull();
      expect(policyMatches!.length).toBe(tablesWithRls.length);
    });
  });

  describe('pool.ts — exports and AsyncLocalStorage', () => {
    it('exports getPool, adminQuery, and rlsStore', async () => {
      const poolModule = await import('../db/pool');
      expect(poolModule.getPool).toBeTypeOf('function');
      expect(poolModule.adminQuery).toBeTypeOf('function');
      expect(poolModule.rlsStore).toBeDefined();
    });
  });

  describe('rlsContext middleware — AsyncLocalStorage', () => {
    it('sets req.auth defaults when no auth present', async () => {
      const { rlsContextMiddleware } = await import('../middleware/rlsContext');
      const req = { auth: undefined } as unknown as import('express').Request;
      const res = {} as unknown as import('express').Response;
      const next = vi.fn();

      rlsContextMiddleware(req, res, next);

      expect(req.auth).toEqual({ userId: null, orgId: null, sessionId: null });
      expect(next).toHaveBeenCalled();
    });

    it('runs next() inside AsyncLocalStorage context', async () => {
      const { rlsContextMiddleware } = await import('../middleware/rlsContext');
      const { rlsStore } = await import('../db/pool');

      const req = { auth: { userId: 'user_test', orgId: 'org_test', sessionId: 's1' } } as unknown as import('express').Request;
      const res = {} as unknown as import('express').Response;

      let capturedCtx: { userId: string | null; orgId: string | null } | undefined;
      const next = vi.fn(() => {
        capturedCtx = rlsStore.getStore();
      });

      rlsContextMiddleware(req, res, next);

      expect(next).toHaveBeenCalled();
      expect(capturedCtx).toEqual({ userId: 'user_test', orgId: 'org_test' });
    });

    it('context is undefined outside middleware scope', async () => {
      const { rlsStore } = await import('../db/pool');
      expect(rlsStore.getStore()).toBeUndefined();
    });
  });

  describe('pool.ts — RLS context application', () => {
    it('uses set_config for parameterized session vars (not string interpolation)', async () => {
      const poolSrc = fs.readFileSync(
        path.join(__dirname, '../db/pool.ts'),
        'utf8'
      );
      expect(poolSrc).toContain("set_config('app.user_id', $1, true)");
      expect(poolSrc).toContain("set_config('app.org_id', $1, true)");
      expect(poolSrc).toContain('SET ROLE application_role');
      expect(poolSrc).toContain('RESET ROLE');
    });
  });
});
