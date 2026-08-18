/**
 * SQL/TypeScript parity for the run-reference check character.
 *
 * The checksum exists twice on purpose: generation is a Postgres column default
 * (migration 055) so that every run insert path is covered, and validation is in
 * TypeScript so a mistyped reference can be rejected without a database round
 * trip. Duplication is only safe if something pins the two together — otherwise
 * a drift shows up as references that generate fine and then can never be
 * looked up, which is exactly the kind of bug nobody notices until support
 * needs it.
 *
 * Requires a migrated Postgres. Set TEST_DATABASE_URL; skipped when unset.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { initDb, adminQuery } from '../db/pool';
import { parseRunReference, runRefCheckChar } from '../services/research/runReference';

const testDbUrl = process.env.TEST_DATABASE_URL?.trim();
const describeIfDb = testDbUrl ? describe : describe.skip;

describeIfDb('run reference SQL/TS parity (integration)', () => {
  beforeAll(async () => {
    process.env.DATABASE_URL = testDbUrl;
    await initDb();
  });

  it('computes the same check character as the database', async () => {
    const payloads = [
      'R1202608180042ABCDE',
      'R1202601010000ZZZZZ',
      'R1199912312359 0000'.replace(' ', '0'),
      'R120260818004200000',
      'R12026081800427K3M9',
    ];

    const rows = await adminQuery<{ payload: string; check: string }>(
      `SELECT p AS payload, run_ref_check_char(p) AS check
         FROM unnest($1::text[]) AS p`,
      [payloads]
    );

    expect(rows).toHaveLength(payloads.length);
    for (const row of rows) {
      expect(runRefCheckChar(row.payload), `payload ${row.payload}`).toBe(row.check);
    }
  });

  it('generates references the TypeScript parser accepts', async () => {
    const rows = await adminQuery<{ ref: string }>(
      `SELECT generate_run_ref() AS ref FROM generate_series(1, 25)`
    );
    expect(rows).toHaveLength(25);

    for (const { ref } of rows) {
      const parsed = parseRunReference(ref);
      expect(parsed.ok, `${ref} rejected: ${parsed.reason}`).toBe(true);
      expect(parsed.ref).toBe(ref);
    }

    // Distinct within a single minute bucket — the random component is doing
    // its job, not silently collapsing to a constant.
    expect(new Set(rows.map((r) => r.ref)).size).toBe(rows.length);
  });

  it('is deterministic when seeded, so backfill can be replayed', async () => {
    const rows = await adminQuery<{ a: string; b: string }>(
      `SELECT generate_run_ref('2026-08-18T00:42:00Z'::timestamptz, 'fixed-seed') AS a,
              generate_run_ref('2026-08-18T00:42:00Z'::timestamptz, 'fixed-seed') AS b`
    );
    expect(rows[0]!.a).toBe(rows[0]!.b);
    expect(parseRunReference(rows[0]!.a).ok).toBe(true);
  });

  it('assigns a reference to every run, including one that failed', async () => {
    const rows = await adminQuery<{ missing: string }>(
      `SELECT COUNT(*)::text AS missing
         FROM research_runs
        WHERE run_ref IS NULL`
    );
    expect(rows[0]!.missing).toBe('0');
  });
});
