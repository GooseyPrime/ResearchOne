import fs from 'fs';
import path from 'path';
import { describe, expect, it } from 'vitest';

/**
 * Static migration contract — catches accidental removal of audit / FK / USING guard.
 */
describe('030_harden_wallet_holds_run_id_uuid migration', () => {
  const sqlPath = path.join(__dirname, '../db/migrations/030_harden_wallet_holds_run_id_uuid.sql');

  it('defines audit table and records invalid vs orphan reasons', () => {
    const sql = fs.readFileSync(sqlPath, 'utf8');
    expect(sql).toContain('wallet_holds_run_id_migration_audit');
    expect(sql).toContain('invalid_uuid');
    expect(sql).toContain('orphan_no_matching_run');
    expect(sql).toMatch(/ALTER COLUMN run_id TYPE UUID/i);
    expect(sql).toContain('wallet_holds_run_id_fkey');
    expect(sql).toContain('REFERENCES research_runs(id)');
    expect(sql).toContain('ON DELETE SET NULL');
    expect(sql).toContain('idx_wallet_holds_run_id');
    expect(sql).toMatch(/USING\s*\(/i);
  });
});
