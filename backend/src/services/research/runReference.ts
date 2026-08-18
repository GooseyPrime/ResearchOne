/**
 * Run reference — the human-readable identifier for a research run.
 *
 * Format:  `R1-YYYYMMDD-HHMM-XXXXX-C`
 *
 * Assigned to EVERY run, including failures. Runs are the unit that can fail;
 * a report only exists once a run succeeded, so an identifier hung off reports
 * would be missing for exactly the cases someone needs to look up.
 *
 * Generation lives in SQL (migration 055) as a column default, because runs are
 * inserted from many code paths — several of which fall back through smaller
 * column lists when a migration has not been applied. A default covers all of
 * them, including paths added later. This module is the READ side: it parses
 * what a human typed or pasted back into the canonical form.
 *
 * The checksum is duplicated here so a malformed reference can be rejected
 * without a database round-trip. `runReference.parity.test.ts` pins this
 * implementation against the SQL one; if the two ever disagree that test fails
 * rather than the mismatch surfacing as a mysteriously unfindable run.
 */

/**
 * Crockford base32. No I, L, O or U — the first three are confusable with 1 and
 * 0 when transcribed from a screenshot, and dropping U avoids accidental
 * profanity in generated identifiers.
 */
export const RUN_REF_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

export const RUN_REF_PREFIX = 'R1';

/** Canonical shape, after normalisation. */
export const RUN_REF_PATTERN = /^R1-(\d{8})-(\d{4})-([0-9A-Z]{5})-([0-9A-Z])$/;

/**
 * Characters a human plausibly types instead of the intended one. Crockford
 * specifies these substitutions; without them a correctly-read reference that
 * was typed with a letter O instead of a zero would simply not be found.
 */
const CONFUSABLE: Record<string, string> = {
  I: '1',
  L: '1',
  O: '0',
  U: 'V',
};

/**
 * Check character over the reference payload (everything before it, dashes
 * removed). Position-weighted so a transposition changes the result.
 *
 * Must stay identical to `run_ref_check_char` in migration 055.
 */
export function runRefCheckChar(payload: string): string {
  let total = 0;
  for (let position = 0; position < payload.length; position += 1) {
    const index = RUN_REF_ALPHABET.indexOf(payload[position]!);
    if (index >= 0) total += index * (position + 1);
  }
  return RUN_REF_ALPHABET[total % 32]!;
}

export interface RunReferenceParse {
  ok: boolean;
  /** Canonical reference, present when `ok`. */
  ref?: string;
  reason?: 'empty' | 'malformed' | 'check_failed';
}

/**
 * Normalise user input into a canonical run reference.
 *
 * Accepts what people actually paste: lower case, missing or extra dashes,
 * surrounding whitespace, a stray "Run " prefix, and the confusable characters
 * above. Rejects anything whose check character does not match, which catches
 * single-character typos and transpositions before they become a lookup that
 * returns nothing for no visible reason.
 */
export function parseRunReference(input: string | null | undefined): RunReferenceParse {
  const raw = (input ?? '').trim();
  if (!raw) return { ok: false, reason: 'empty' };

  let cleaned = raw
    .toUpperCase()
    .replace(/^RUN\s*(?:REF(?:ERENCE)?)?\s*[:#]?\s*/, '')
    .replace(/[\s‐-―_.]/g, '')
    .replace(/-/g, '');

  cleaned = cleaned.replace(/[ILOU]/g, (char) => CONFUSABLE[char] ?? char);

  // R1 + 8 date + 4 time + 5 random + 1 check = 20 characters.
  if (cleaned.length !== 20 || !cleaned.startsWith(RUN_REF_PREFIX)) {
    return { ok: false, reason: 'malformed' };
  }

  const date = cleaned.slice(2, 10);
  const time = cleaned.slice(10, 14);
  const random = cleaned.slice(14, 19);
  const check = cleaned.slice(19, 20);

  if (!/^\d{8}$/.test(date) || !/^\d{4}$/.test(time)) return { ok: false, reason: 'malformed' };
  for (const char of random + check) {
    if (!RUN_REF_ALPHABET.includes(char)) return { ok: false, reason: 'malformed' };
  }

  if (runRefCheckChar(`${RUN_REF_PREFIX}${date}${time}${random}`) !== check) {
    return { ok: false, reason: 'check_failed' };
  }

  return { ok: true, ref: `${RUN_REF_PREFIX}-${date}-${time}-${random}-${check}` };
}

/**
 * Build a reference from its parts. Used by tests and by any future
 * application-side generation; production generation is the SQL default.
 */
export function formatRunReference(args: { date: string; time: string; random: string }): string {
  const payload = `${RUN_REF_PREFIX}${args.date}${args.time}${args.random}`;
  return `${RUN_REF_PREFIX}-${args.date}-${args.time}-${args.random}-${runRefCheckChar(payload)}`;
}
