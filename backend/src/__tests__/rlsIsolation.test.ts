import { describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('RLS isolation', () => {
  describe('migration 021 — role and grants', () => {
    const sql = fs.readFileSync(
      path.join(__dirname, '../db/migrations/021_rls_setup.sql'),
      'utf8'
    );

    it('creates application_role', () => {
      expect(sql).toContain('application_role');
      expect(sql).toContain('NOINHERIT');
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

  describe('pool.ts — dual pool architecture', () => {
    it('exports getPool and getAdminPool', async () => {
      const poolModule = await import('../db/pool');
      expect(poolModule.getPool).toBeTypeOf('function');
      expect(poolModule.getAdminPool).toBeTypeOf('function');
      expect(poolModule.adminQuery).toBeTypeOf('function');
    });
  });

  describe('rlsContext middleware — session variable setting', () => {
    it('sets req.auth defaults when no auth present', async () => {
      const { rlsContextMiddleware } = await import('../middleware/rlsContext');
      const req = { auth: undefined } as unknown as import('express').Request;
      const res = { on: vi.fn() } as unknown as import('express').Response;
      const next = vi.fn();

      rlsContextMiddleware(req, res, next);

      expect(req.auth).toEqual({ userId: null, orgId: null, sessionId: null });
      expect(next).toHaveBeenCalled();
    });
  });
});
