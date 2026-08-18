import { describe, it, expect } from 'vitest';

import {
  formatRunReference,
  parseRunReference,
  runRefCheckChar,
  RUN_REF_ALPHABET,
  RUN_REF_PATTERN,
} from '../services/research/runReference';

/**
 * Run references are quoted by humans — read off a screen, typed into a support
 * form, pasted out of an email that reflowed it. These tests pin the tolerances
 * that make that survivable, and the check character that stops a typo from
 * looking like a missing run.
 */

const REF = formatRunReference({ date: '20260818', time: '0042', random: '7K3M9' });

describe('run reference format', () => {
  it('produces the documented canonical shape', () => {
    expect(REF).toMatch(RUN_REF_PATTERN);
    expect(REF.startsWith('R1-20260818-0042-7K3M9-')).toBe(true);
    // R1 + 4 dashes + 8 date + 4 time + 5 random + 1 check
    expect(REF).toHaveLength(24);
  });

  it('round-trips through the parser unchanged', () => {
    expect(parseRunReference(REF)).toEqual({ ok: true, ref: REF });
  });

  it('uses an alphabet with no confusable characters', () => {
    for (const char of 'ILOU') {
      expect(RUN_REF_ALPHABET.includes(char)).toBe(false);
    }
    expect(RUN_REF_ALPHABET).toHaveLength(32);
  });
});

describe('parseRunReference tolerances', () => {
  it('accepts what people actually paste', () => {
    const variants = [
      REF.toLowerCase(),
      `  ${REF}  `,
      REF.replace(/-/g, ''),
      REF.replace(/-/g, ' '),
      `Run ref: ${REF}`,
      `RUN #${REF}`,
    ];
    for (const variant of variants) {
      expect(parseRunReference(variant), variant).toEqual({ ok: true, ref: REF });
    }
  });

  it('maps Crockford confusables so a misread reference still resolves', () => {
    // A reference containing 0 and 1 typed as O and I.
    const numeric = formatRunReference({ date: '20260818', time: '0042', random: '01234' });
    const misread = numeric.replace('01234', 'OI234');
    expect(parseRunReference(misread)).toEqual({ ok: true, ref: numeric });
  });

  it('rejects a single-character typo via the check character', () => {
    // Change one payload character; the check character no longer agrees.
    const typo = REF.replace('7K3M9', '7K3N9');
    const result = parseRunReference(typo);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('check_failed');
  });

  it('rejects a transposition, which a plain checksum would miss', () => {
    const transposed = formatRunReference({ date: '20260818', time: '0042', random: '7K3M9' })
      .replace('7K3M9', '7K3M9')
      .replace('-0042-', '-0402-');
    const result = parseRunReference(transposed);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('check_failed');
  });

  it('reports empty and malformed input distinctly from a bad check', () => {
    expect(parseRunReference('').reason).toBe('empty');
    expect(parseRunReference(null).reason).toBe('empty');
    expect(parseRunReference('not-a-reference').reason).toBe('malformed');
    expect(parseRunReference('R1-2026-0042-7K3M9-4').reason).toBe('malformed');
    // Right length, wrong prefix.
    expect(parseRunReference('X1202608180042 7K3M94').reason).toBe('malformed');
  });

  it('rejects a truncated reference rather than guessing', () => {
    expect(parseRunReference(REF.slice(0, -1)).ok).toBe(false);
  });
});

describe('runRefCheckChar', () => {
  it('is deterministic and in-alphabet', () => {
    for (const payload of ['R1202608180042 7K3M9'.replace(' ', ''), 'R1202601010000AAAAA']) {
      const check = runRefCheckChar(payload);
      expect(RUN_REF_ALPHABET.includes(check)).toBe(true);
      expect(runRefCheckChar(payload)).toBe(check);
    }
  });

  it('detects EVERY single-character substitution, exhaustively', () => {
    // Codex found the counterexample that motivated moving to Luhn mod N: with
    // the old position-weighted sum, changing the eighth character of
    // R1202608180042ABCDE from 8 to 4 shifted the total by exactly 32 and left
    // the check character unchanged. This now walks every position against
    // every other alphabet character rather than sampling a +1 shift.
    for (const base of ['R1202608180042ABCDE', 'R1202601010000ZZZZZ', 'R1199912312359Q7T2V']) {
      const check = runRefCheckChar(base);
      for (let i = 2; i < base.length; i += 1) {
        const original = base[i]!;
        for (const replacement of RUN_REF_ALPHABET) {
          if (replacement === original) continue;
          const mutated = `${base.slice(0, i)}${replacement}${base.slice(i + 1)}`;
          expect(
            runRefCheckChar(mutated),
            `${base}: position ${i} ${original}->${replacement} was not detected`
          ).not.toBe(check);
        }
      }
    }
  });

  it('rejects the specific mistype Codex identified', () => {
    const base = 'R1202608180042ABCDE';
    // Eighth character 8 -> 4.
    const mutated = `${base.slice(0, 9)}4${base.slice(10)}`;
    expect(mutated).not.toBe(base);
    expect(runRefCheckChar(mutated)).not.toBe(runRefCheckChar(base));
  });

  it('detects adjacent transpositions', () => {
    const base = 'R1202608180042ABCDE';
    let missed = 0;
    for (let i = 2; i < base.length - 1; i += 1) {
      if (base[i] === base[i + 1]) continue;
      const swapped = `${base.slice(0, i)}${base[i + 1]}${base[i]}${base.slice(i + 2)}`;
      if (runRefCheckChar(swapped) === runRefCheckChar(base)) missed += 1;
    }
    // Luhn mod N misses only pairs differing by exactly N/2; none here.
    expect(missed).toBe(0);
  });

  it('distinguishes transposed neighbours', () => {
    expect(runRefCheckChar('R1202608180042ABCDE')).not.toBe(
      runRefCheckChar('R1202608180042BACDE')
    );
  });
});
