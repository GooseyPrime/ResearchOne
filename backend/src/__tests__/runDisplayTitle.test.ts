import { describe, expect, it } from 'vitest';
import {
  GENERATED_TITLE_MAX_LENGTH,
  deriveRunDisplayTitle,
} from '../services/research/titleShaping';
import { stripHeadingDecoration } from '../services/reasoning/reportGenerator';

describe('deriveRunDisplayTitle', () => {
  it('refuses rather than handing the input back', () => {
    // A sanitizer has two honest outcomes: a safe value or a refusal. The third
    // outcome — return the input and let the caller deal with it — is what left
    // splitCredentials only usually sanitizing (#224, Rule 44 T9).
    expect(deriveRunDisplayTitle(undefined)).toBeNull();
    expect(deriveRunDisplayTitle(null)).toBeNull();
    expect(deriveRunDisplayTitle('')).toBeNull();
    expect(deriveRunDisplayTitle('   \n\t  ')).toBeNull();
    expect(deriveRunDisplayTitle(42 as unknown as string)).toBeNull();
  });

  it('keeps a one-sentence summary as written', () => {
    expect(deriveRunDisplayTitle('Compares EU and US medical device pathways')).toBe(
      'Compares EU and US medical device pathways'
    );
  });

  it('takes only the first sentence', () => {
    expect(
      deriveRunDisplayTitle('Compares EU and US pathways. Both regimes are actively contested.')
    ).toBe('Compares EU and US pathways');
  });

  it('does not split on an initialism', () => {
    expect(deriveRunDisplayTitle('Reviews U.S. and E.U. filing regimes')).toBe(
      'Reviews U.S. and E.U. filing regimes'
    );
  });

  it('does not split on a listed abbreviation followed by a capital', () => {
    // The case that caught the first implementation. Its lookahead required a
    // non-lowercase character after the boundary, and both initialism fixtures
    // happened to be followed by lowercase words, so the suite agreed with the
    // code instead of checking it (Rule 44 T1). 'vs. Mexico' does not.
    expect(deriveRunDisplayTitle('Compares Canada vs. Mexico tariff schedules')).toBe(
      'Compares Canada vs. Mexico tariff schedules'
    );
    expect(deriveRunDisplayTitle('Surveys filings from Roche, Bayer etc. Across the EU')).toBe(
      'Surveys filings from Roche, Bayer etc. Across the EU'
    );
  });

  it('splits on ! and ? without consulting the abbreviation set', () => {
    expect(deriveRunDisplayTitle('Does the pathway diverge? Evidence says yes.')).toBe(
      'Does the pathway diverge?'
    );
  });

  it('does not split a non-Latin initialism, which a case-based boundary would', () => {
    // The first implementation gated the boundary on `[^a-z]`. Every Cyrillic
    // character is outside `[a-z]`, so it split at EVERY period — including
    // both initials below. Deciding sentence structure from Latin letter case
    // is the `split(/[^a-z0-9]+/)` defect of #221 in a new place (Rule 44 T2).
    expect(deriveRunDisplayTitle('Обзор работ А. Б. Иванова по регулированию')).toBe(
      'Обзор работ А. Б. Иванова по регулированию'
    );
  });

  it('drops a title-final period, as generated report titles already do', () => {
    // Pre-existing stripHeadingDecoration behaviour, asserted here so the
    // pipeline's output shape is pinned rather than assumed.
    expect(deriveRunDisplayTitle('Compares EU and US pathways. Both are contested.')).toBe(
      'Compares EU and US pathways'
    );
  });

  it('flattens the whitespace a multi-line summary carries', () => {
    expect(deriveRunDisplayTitle('Compares\n  EU   and\tUS\npathways')).toBe(
      'Compares EU and US pathways'
    );
  });

  it('strips Markdown decoration instead of storing it', () => {
    // The shipped defect this whole column exists to fix: dossier cards reading
    // "# Research Objective: ..." with the decoration rendered as text.
    expect(deriveRunDisplayTitle('**Compares EU and US pathways**')).toBe(
      'Compares EU and US pathways'
    );
    expect(deriveRunDisplayTitle('"Compares EU and US pathways"')).toBe(
      'Compares EU and US pathways'
    );
  });

  it('strips wrappers BEFORE cutting at a sentence boundary', () => {
    // Codex, post-merge review of #227. The order used to be reversed, so a
    // summary wrapped in emphasis had its boundary search run against a string
    // whose first sentence still carried the opening `**`, leaving the closing
    // one orphaned on a fragment that no longer ended the string.
    expect(deriveRunDisplayTitle('**Compares EU and US pathways. Both are contested.**')).toBe(
      'Compares EU and US pathways'
    );
    expect(deriveRunDisplayTitle('"Reviews filing regimes. Two jurisdictions."')).toBe(
      'Reviews filing regimes'
    );
  });

  it('truncates an over-long summary at the shared cap', () => {
    const long = `${'Compares regulatory pathways across jurisdictions '.repeat(6)}end`;
    const out = deriveRunDisplayTitle(long);
    expect(out).not.toBeNull();
    expect(out!.length).toBeLessThanOrEqual(GENERATED_TITLE_MAX_LENGTH);
    expect(out!.endsWith('…')).toBe(true);
    // Truncated, not merely echoed — the assertion that fails if the shaping
    // step is removed and the summary is returned as-is.
    expect(out!.length).toBeLessThan(long.length);
  });

  it('uses the same cap as the generated report title', () => {
    // One constant, one trim. Two copies would drift and a run's title would
    // change shape the moment its report finalised (Rule 44 T7).
    expect(GENERATED_TITLE_MAX_LENGTH).toBe(120);
  });
});

describe('reportGenerator re-export (Rule 44 T4)', () => {
  it('still exposes stripHeadingDecoration after the move to titleShaping', () => {
    // Moving a function must not remove a consumer's import path.
    expect(stripHeadingDecoration('# **Overview**'.replace('# ', ''))).toBe('Overview');
  });
});
