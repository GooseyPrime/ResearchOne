import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Postgres rejects a statement in which one parameter is used with two
 * different deduced types ("inconsistent types deduced for parameter", 42P08).
 * The telemetry insert used $15 once bare, for a BIGINT column, and once cast
 * to double precision, so every insert failed and no model call was recorded.
 */
const STATEMENTS = [
  { name: 'runtime insert', file: '../services/telemetry/costSidecar.ts', expected: '$15::bigint, to_timestamp($15::bigint / 1000.0)' },
  { name: 'backfill insert', file: '../../scripts/backfill-cost-from-model-log.ts', expected: '$13::bigint, to_timestamp($13::bigint / 1000.0)' },
];

describe.each(STATEMENTS)('agent_executions $name', ({ file, expected }) => {
  const source = readFileSync(path.join(__dirname, file), 'utf8');
  const start = source.indexOf('INSERT INTO agent_executions');
  const statement = source.slice(start, source.indexOf('ON CONFLICT (idempotency_key)', start));

  it('casts every use of a repeated parameter the same way', () => {
    const uses = new Map<string, Set<string>>();
    for (const match of statement.matchAll(/\$(\d+)(::[a-z ]+?)?(?=[\s,)/])/g)) {
      const casts = uses.get(match[1]) ?? new Set<string>();
      casts.add((match[2] ?? '').trim());
      uses.set(match[1], casts);
    }
    expect(uses.size).toBeGreaterThan(0);
    for (const [param, casts] of uses) {
      expect({ param, casts: [...casts] }).toEqual({ param, casts: [[...casts][0]] });
    }
  });

  it('writes the start time from the same integer it stores', () => {
    expect(statement).toContain(expected);
  });
});
