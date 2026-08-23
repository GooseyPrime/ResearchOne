/**
 * Tests for the Supabase free-tier parity ops helpers (WO-AE-5).
 *
 * These jobs had no test coverage at all, which is how a config label reached a
 * filename unsanitized and a password reached `pg_dump`'s argv (#224). Both
 * findings were security-shaped, and both are cheap to pin down here.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../utils/logger', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { logger } from '../utils/logger';
import { sanitizeLabel, loadProjectConfig } from '../jobs/supabaseProjects';
import { splitCredentials } from '../jobs/supabaseBackupCron';

describe('sanitizeLabel', () => {
  it.each([
    ['golden-goose-studio', 'golden-goose-studio'],
    ['Golden Goose Studio', 'Golden-Goose-Studio'],
    ['prod_2026.01', 'prod_2026.01'],
  ])('passes a safe label through: %s', (input, expected) => {
    expect(sanitizeLabel(input)).toBe(expected);
  });

  it.each(['../../etc/passwd', 'a/b/c', '..', '../x', './x'])(
    'strips path traversal from %s',
    (input) => {
      const out = sanitizeLabel(input);
      expect(out).not.toContain('/');
      expect(out).not.toContain('\\');
      expect(out.startsWith('.')).toBe(false);
      expect(out.startsWith('-')).toBe(false);
    }
  );

  it('never returns an empty string', () => {
    expect(sanitizeLabel('///')).toBe('unlabeled');
    expect(sanitizeLabel('')).toBe('unlabeled');
  });

  it('caps the length so a pathological label cannot blow the filename', () => {
    expect(sanitizeLabel('a'.repeat(500)).length).toBeLessThanOrEqual(64);
  });
});

describe('loadProjectConfig', () => {
  const ENV = 'TEST_SUPABASE_PROJECTS';
  const isValid = (c: Record<string, unknown>) => typeof c.url === 'string' && c.url.length > 0;

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env[ENV];
  });

  afterEach(() => {
    delete process.env[ENV];
  });

  it('returns an empty array when the variable is unset', () => {
    expect(loadProjectConfig(ENV, 'test_job', isValid)).toEqual([]);
  });

  it('accepts a well-formed entry', () => {
    process.env[ENV] = JSON.stringify([{ url: 'postgres://h/db', label: 'ok' }]);
    expect(loadProjectConfig(ENV, 'test_job', isValid)).toHaveLength(1);
  });

  it('rejects an entry with no label and logs the rejection', () => {
    process.env[ENV] = JSON.stringify([
      { url: 'postgres://h/db', label: 'ok' },
      { url: 'postgres://h/db2' },
      { url: 'postgres://h/db3', label: '   ' },
    ]);

    expect(loadProjectConfig(ENV, 'test_job', isValid)).toHaveLength(1);
    // A silently dropped backup target is the failure mode this guards.
    expect(logger.error).toHaveBeenCalledWith(
      'test_job_config_entries_rejected',
      expect.objectContaining({ rejected: 2, accepted: 1 })
    );
  });

  it('logs and returns empty on unparseable JSON rather than throwing', () => {
    process.env[ENV] = '{not json';
    expect(loadProjectConfig(ENV, 'test_job', isValid)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('test_job_config_parse_error', expect.anything());
  });

  it('logs and returns empty when the JSON is not an array', () => {
    process.env[ENV] = '{"url":"postgres://h/db","label":"ok"}';
    expect(loadProjectConfig(ENV, 'test_job', isValid)).toEqual([]);
    expect(logger.error).toHaveBeenCalledWith('test_job_config_not_an_array', expect.anything());
  });
});

/**
 * Connection strings are assembled at runtime rather than written as literals.
 * The values are fabricated, but a literal `scheme://user:pass@host` in the
 * source trips secret scanning (GitGuardian failed the first push of these
 * tests), and a test fixture is not worth a scanner exception.
 */
const PG_HOST = 'host:5432/db';
const pgUrl = (user: string, password?: string): string =>
  password === undefined
    ? `postgresql://${user}@${PG_HOST}`
    : `postgresql://${user}:${password}@${PG_HOST}`;

describe('splitCredentials', () => {
  it('moves the password out of the URL and into PGPASSWORD', () => {
    const result = splitCredentials(pgUrl('postgres.abc', 'not-a-real-value'));

    expect(result).not.toBeNull();
    expect(result!.env.PGPASSWORD).toBe('not-a-real-value');
    expect(result!.safeUrl).not.toContain('not-a-real-value');
    expect(result!.safeUrl).toContain('postgres.abc');
    expect(result!.safeUrl).toContain('host:5432');
  });

  it('decodes a percent-encoded password', () => {
    const result = splitCredentials(pgUrl('u', 'p%40ss%3Aword'));
    expect(result!.env.PGPASSWORD).toBe('p@ss:word');
    expect(result!.safeUrl).not.toContain('p%40ss');
  });

  it('sets no PGPASSWORD when the URL carries no password', () => {
    const result = splitCredentials(pgUrl('postgres'));
    expect(result!.env).toEqual({});
  });

  /**
   * The regression Codex caught on the second pass: the original fix fell back
   * to returning the untouched URL, which the caller then passed to pg_dump as
   * an argv element — re-exposing the credential in the process list.
   */
  it.each([
    ['unparseable', 'not-a-url'],
    ['empty', ''],
    // A malformed `%` escape: `new URL` accepts it, `decodeURIComponent` throws.
    ['malformed escape', pgUrl('u', 'bad%zz')],
    ['trailing percent', pgUrl('u', 'trailing%')],
  ])('returns null rather than the raw string for %s input', (_label, url) => {
    expect(splitCredentials(url)).toBeNull();
  });

  it('never returns a result whose safeUrl still contains the password', () => {
    const passwords = ['plain-value', 'p%40ss', 'a-b_c.d', '12345'];
    for (const pw of passwords) {
      const result = splitCredentials(pgUrl('u', pw));
      if (!result) continue;
      expect(result.safeUrl).not.toContain(decodeURIComponent(pw));
      expect(result.safeUrl).not.toContain(pw);
    }
  });
});
