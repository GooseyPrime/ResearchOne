import { describe, expect, it } from 'vitest';
import { CHALLENGE_PASS_SYSTEM_PREFIX } from '../services/reasoning/reasoningModelPolicy';

function extractFunctionSource(src: string, functionName: string): string {
  const start = src.indexOf(`function ${functionName}`);
  expect(start).toBeGreaterThan(-1);

  const bodyStart = src.indexOf('{', start);
  expect(bodyStart).toBeGreaterThan(-1);

  let depth = 0;
  for (let index = bodyStart; index < src.length; index += 1) {
    const char = src[index];
    if (char === '{') depth += 1;
    if (char === '}') depth -= 1;
    if (depth === 0) {
      return src.slice(start, index + 1);
    }
  }

  throw new Error(`Could not extract function ${functionName}`);
}

/**
 * WO-AH — the challenge pass gets the same instruction on every report.
 *
 * `applySystemAugmentations` returned early unless `engineVersion === 'v2'`, so
 * a Standard run's challenge pass ran WITHOUT the adversarial prefix while the
 * Deep card sold that pass as what you were paying for. The difference was a
 * paywall, not a judgement about the request.
 *
 * The function is module-private, so this asserts the property through the
 * exported constant and the source of the call site rather than reaching in.
 */
describe('challenge pass instruction', () => {
  it('is not named or described as a version-specific thing', () => {
    // The old name, RED_TEAM_V2_SYSTEM_PREFIX, encoded the gate in the identifier.
    expect(CHALLENGE_PASS_SYSTEM_PREFIX).toBeTruthy();
    expect(CHALLENGE_PASS_SYSTEM_PREFIX).toContain('adversarial researcher');
  });

  it('is applied without consulting engineVersion', async () => {
    // Reading the source is a blunt check, but the alternative is exporting a
    // private function purely to assert on it, and the property being protected
    // IS "no engine check stands between a run and its challenge pass".
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const src = await fs.readFile(
      path.join(__dirname, '../services/openrouter/openrouterService.ts'),
      'utf8'
    );

    const body = extractFunctionSource(src, 'applySystemAugmentations');

    expect(body).toContain(CHALLENGE_PASS_SYSTEM_PREFIX.slice(0, 0) + 'CHALLENGE_PASS_SYSTEM_PREFIX');
    // No early return on the engine, and no engine comparison anywhere in it.
    expect(body).not.toMatch(/engineVersion[^\n]*!==\s*'v2'/);
    expect(body).not.toMatch(/engineVersion[^\n]*===\s*'v2'/);
  });
});
