/**
 * Two role nicknames are retired from this repository (RJ-017, Brandon's order
 * of 8 Oct 2026): the old name of the step that restates a finding in its
 * strongest form, and the old name of the step that tests findings against
 * other sources. Their names are now `strongest_form` and `double_check`, and
 * a customer sees one step, "Double-check".
 *
 * This test reads every text file in the repository, and every file and folder
 * name, and fails when either word appears, in any letter case, joined to
 * other letters or not. There are no exceptions: the migration that upgrades an
 * older database puts the old column names together from halves, and so does
 * this test. The backend carries the same test, so the check runs whichever
 * half of the repository a change touches.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(__dirname, '..', '..', '..', '..');

/** The two words, in halves, so this file passes its own check. */
const RETIRED = new RegExp([`${'ste'}${'el'}[-_ ]?${'m'}${'an'}`, `${'ske'}${'ptic'}`].join('|'), 'i');

/** Places a file may use either word. Empty on purpose: there is none. */
const ALLOWED: ReadonlyArray<{ file: string; line: number }> = [];

const SKIPPED_DIRECTORIES = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.vercel', '.turbo', '.cache', 'playwright-report', 'test-results']);
const BINARY = /\.(png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|otf|eot|zip|gz|mp4|webm|mp3|wasm|docx|xlsx|pptx)$/i;

function findings(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      if (SKIPPED_DIRECTORIES.has(name)) continue;
      const path = join(dir, name);
      const file = relative(root, path).replace(/\\/g, '/');
      if (RETIRED.test(name)) out.push(`${file} (file name)`);
      const stats = statSync(path);
      if (stats.isDirectory()) {
        walk(path);
        continue;
      }
      if (!stats.isFile() || BINARY.test(name)) continue;
      const text = readFileSync(path, 'utf8');
      // A file with a NUL byte is not text.
      if (text.includes('\u0000') || !RETIRED.test(text)) continue;
      text.split('\n').forEach((line, index) => {
        if (RETIRED.test(line) && !ALLOWED.some((allowed) => allowed.file === file && allowed.line === index + 1)) {
          out.push(`${file}:${index + 1}`);
        }
      });
    }
  };
  walk(root);
  return out;
}

describe('retired role words', () => {
  it('appear nowhere in the repository: no file, no file name, no exception', () => {
    expect(ALLOWED).toEqual([]);
    expect(findings(REPO_ROOT)).toEqual([]);
  }, 60_000);

  it('the check finds each word in every form it was written in', () => {
    const a = `${'steel'}${'man'}`;
    const b = `${'skep'}${'tic'}`;
    for (const text of [a, a.toUpperCase(), `${a}Mode`, `${a}_pass_count`, `${'steel'}-${'man'}`, `${a}ning`, `run${a.charAt(0).toUpperCase()}${a.slice(1)}Pass`]) {
      expect(RETIRED.test(text), text).toBe(true);
    }
    for (const text of [b, b.toUpperCase(), `${b}Mode`, `${b}_annotations_count`, `${b}al`, `${b}ism`, `is${b.charAt(0).toUpperCase()}${b.slice(1)}`]) {
      expect(RETIRED.test(text), text).toBe(true);
    }
    for (const text of ['strongest_form', 'double_check', 'Double-check', 'steel prices', 'a human reviewer']) {
      expect(RETIRED.test(text), text).toBe(false);
    }
  });
});
