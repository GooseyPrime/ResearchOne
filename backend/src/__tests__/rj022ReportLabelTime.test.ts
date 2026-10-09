/**
 * RJ-022. Taking labels out of report text must take time in proportion to the
 * text. A "(inference, Chunk 1, Chunk 2, ..." list that no bracket closed used
 * to double the time with each item; on the server that holds the API process
 * for every user.
 */
import { describe, expect, it } from 'vitest';
import { stripInternalLabelsFromReport } from '../services/formatting/reportPresentation';

const list = (items: number): string =>
  `(inference, ${Array.from({ length: items }, (_, i) => `Chunk ${i + 1}`).join(', ')} and others`;

describe('RJ-022: report label clean-up time', () => {
  it('does not double with each item of a list no bracket closes', () => {
    // Kept short on purpose: before the change 26 items took seconds and each
    // further item doubled it, so a long list would never finish there.
    for (const items of [26, 28]) {
      const started = performance.now();
      const out = stripInternalLabelsFromReport(`The audit found gaps ${list(items)}.`);
      expect(performance.now() - started).toBeLessThan(250);
      expect(out).toContain('The audit found gaps');
    }
  });

  it('keeps the passage numbers of the labels it removes, as before', () => {
    expect(stripInternalLabelsFromReport('Turnout rose (strong_evidence, Chunks 2, 12, 15).')).toBe('Turnout rose [Chunks 2, 12, 15].');
    expect(stripInternalLabelsFromReport('Turnout rose (inference, Chunk 2, Chunk 5).')).toBe('Turnout rose [Chunks 2, 5].');
    expect(stripInternalLabelsFromReport('Turnout rose (inference, Chunk 2 and Chunk 5).')).toBe('Turnout rose [Chunks 2, 5].');
    expect(stripInternalLabelsFromReport('Turnout rose (inference, Challenger Findings).')).toBe('Turnout rose.');
    expect(stripInternalLabelsFromReport('The office (opened in 1932) kept paper records (see Table 2).')).toBe(
      'The office (opened in 1932) kept paper records (see Table 2).'
    );
  });
});
