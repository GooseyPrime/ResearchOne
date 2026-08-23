/**
 * The floor test that did not exist.
 *
 * PR #224 lowered the retrieval default 0.55 -> 0.45 and the clamp 0.55 -> 0.30,
 * and relaxed the one assertion that touched the value in the same change. The
 * suite stayed green against the exact threshold that previously let the
 * operator's own project notes be cited as external evidence
 * (AGENTS.md:207-210). These tests fail on that change instead.
 */

import { describe, expect, it } from 'vitest';
import {
  RETRIEVAL_MIN_SIMILARITY_FLOOR,
  resolveRetrievalMinSimilarity,
} from '../config/retrievalSimilarityFloor';

describe('resolveRetrievalMinSimilarity', () => {
  it('pins the floor at 0.55', () => {
    expect(RETRIEVAL_MIN_SIMILARITY_FLOOR).toBe(0.55);
  });

  it('defaults to the floor when unset', () => {
    expect(resolveRetrievalMinSimilarity(undefined)).toBe(0.55);
  });

  it.each(['0.30', '0.35', '0.45', '0.5449', '0', '-1'])(
    'clamps a below-floor value up to the floor: %s',
    (raw) => {
      expect(resolveRetrievalMinSimilarity(raw)).toBe(0.55);
    }
  );

  it.each(['0.6', '0.75', '0.9'])('honours a stricter value: %s', (raw) => {
    expect(resolveRetrievalMinSimilarity(raw)).toBe(parseFloat(raw));
  });

  it.each(['', 'not-a-number', 'NaN'])(
    'falls back to the floor rather than NaN for unparseable input: %s',
    (raw) => {
      expect(resolveRetrievalMinSimilarity(raw)).toBe(0.55);
    }
  );

  it('never returns a value below the floor for any input', () => {
    const inputs = [undefined, '', 'x', '-99', '0', '0.1', '0.3', '0.54999', '0.55', '0.8'];
    for (const raw of inputs) {
      expect(resolveRetrievalMinSimilarity(raw)).toBeGreaterThanOrEqual(0.55);
    }
  });
});
