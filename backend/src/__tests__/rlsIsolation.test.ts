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

    it('catches insufficient_privilege to degrade when CREATEROLE is missing', () => {
      expect(sql).toContain('WHEN insufficient_privilege THEN');
    });

    it('gates grants on role existence (skips if role was not created)', () => {
      const roleCheckMatches = sql.match(/IF NOT EXISTS \(SELECT FROM pg_roles WHERE rolname = 'application_role'\)/g);
      expect(roleCheckMatches).not.toBeNull();
      expect(roleCheckMatches!.length).toBeGreaterThanOrEqual(2);
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

    it('gates on application_role existence (degrades when 021 skipped)', () => {
      expect(sql).toContain("IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role')");
      expect(sql).toContain('RETURN');
    });

    it('scopes policy existence checks to public schema and target table', () => {
      for (const table of tablesWithRls) {
        const scopedPolicyCheck = new RegExp(
          `WHERE schemaname = 'public'[\\s\\S]*tablename = '${table}'[\\s\\S]*policyname = '${table}_user_isolation'`
        );
        expect(sql).toMatch(scopedPolicyCheck);
      }
    });
  });

  describe('migration 026 — report_monitors RLS', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/026_report_monitors.sql'),
      'utf8'
    );

    it('gates on application_role existence (degrades when 021 skipped)', () => {
      expect(sql).toContain("IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role')");
      expect(sql).toContain(
        "RAISE NOTICE '026_report_monitors: application_role does not exist — skipping RLS policy creation'"
      );
      expect(sql).toContain('RETURN');
    });

    it('creates policies via EXECUTE with pg_policies idempotency', () => {
      expect(sql).toContain('EXECUTE $p$CREATE POLICY report_monitors_user_isolation ON report_monitors');
      expect(sql).toContain('EXECUTE $p$CREATE POLICY report_monitor_events_via_monitor ON report_monitor_events');
      expect(sql).toContain("policyname = 'report_monitors_user_isolation'");
      expect(sql).toContain("policyname = 'report_monitor_events_via_monitor'");
    });

    it('policies target application_role inside dynamic SQL', () => {
      const policyMatches = sql.match(/TO application_role/g);
      expect(policyMatches).not.toBeNull();
      expect(policyMatches!.length).toBe(2);
    });
  });

  describe('migration 027 — user_notifications RLS', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/027_user_notifications.sql'),
      'utf8'
    );

    it('gates on application_role existence (degrades when 021 skipped)', () => {
      expect(sql).toContain("IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'application_role')");
      expect(sql).toContain(
        "RAISE NOTICE '027_user_notifications: application_role does not exist — skipping RLS policy creation'"
      );
      expect(sql).toContain('RETURN');
    });

    it('creates policy via EXECUTE with pg_policies idempotency', () => {
      expect(sql).toContain('EXECUTE $p$CREATE POLICY user_notifications_user_isolation ON user_notifications');
      expect(sql).toContain("policyname = 'user_notifications_user_isolation'");
    });

    it('policy targets application_role inside dynamic SQL', () => {
      expect(sql).toContain('FOR ALL TO application_role');
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
