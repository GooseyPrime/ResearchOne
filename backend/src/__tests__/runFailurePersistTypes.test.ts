/**
 * The UPDATE that records a failed run used `$5` both as the run status
 * (enum `job_status`) and in a comparison with a text literal. Postgres then
 * deduced two types for one parameter (42P08, "text versus job_status"), so
 * every failed run fell through to the fallback UPDATE and lost its 'aborted'
 * status and its resume decision. Seen in production on every failed run from
 * Oct to Nov 2026.
 *
 * The statement is built inline in the orchestrator, so the guard reads it
 * from the source: every use of `$5` in the primary UPDATE must be cast to the
 * enum, and none may compare it as text.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(join(__dirname, '..', 'services', 'reasoning', 'researchOrchestrator.ts'), 'utf8');

function primaryFailureUpdate(): string {
  const start = source.indexOf('SET status=$5');
  expect(start, 'primary failure UPDATE not found').toBeGreaterThan(-1);
  const end = source.indexOf('WHERE id=$4', start);
  return source.slice(start, end);
}

describe('the UPDATE that records a failed run', () => {
  it('types $5 once, as the status enum, everywhere it is used', () => {
    const sql = primaryFailureUpdate();
    const uses = sql.match(/\$5(::[a-z_]+)?/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(2);
    for (const use of uses) expect(use).toBe('$5::job_status');
  });

  it('never compares $5 with an uncast text literal', () => {
    expect(primaryFailureUpdate()).not.toMatch(/\$5\s*=\s*'/);
  });
});
