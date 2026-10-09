import { afterEach, describe, expect, it } from 'vitest';
import { resolveBaselineLayer } from '../services/openrouter/openrouterService';
import {
  acceptSubjectHeading,
  isoDay,
  renumberCitations,
  buildReferences,
  scoreStructureComplete,
} from '../services/reasoning/baselineReport';
import { digestRetrievedMaterial } from '../services/reasoning/materialSufficiency';
import { storedSectionsToMarkdown } from '../services/eval/runHarness';
import { userChosenWordTarget } from '../services/reasoning/reportGenerator';

afterEach(() => {
  delete process.env.BASELINE_LAYER_ENABLED;
});

describe('Layer 1 source handling is asked for by the caller, not by a switch', () => {
  it.each([['unset', undefined], ['true', 'true'], ['false', 'false']] as const)(
    'applies only when the call asks for it and is not adjudicative, with the retired switch %s',
    (_label, value) => {
      if (value === undefined) delete process.env.BASELINE_LAYER_ENABLED;
      else process.env.BASELINE_LAYER_ENABLED = value;
      expect(resolveBaselineLayer({})).toBe(false);
      expect(resolveBaselineLayer({ isAdjudicative: false })).toBe(false);
      expect(resolveBaselineLayer({ baselineLayer: true })).toBe(true);
      expect(resolveBaselineLayer({ baselineLayer: true, isAdjudicative: false })).toBe(true);
      expect(resolveBaselineLayer({ baselineLayer: true, isAdjudicative: true })).toBe(false);
    }
  );
});

describe('headings in scripts other than Latin', () => {
  it('accepts a valid heading and still rejects the question', () => {
    expect(acceptSubjectHeading('Когда FDA одобрило Casgevy?', 'Одобрение препарата Casgevy')).toBe(true);
    expect(acceptSubjectHeading('FDAはいつCasgevyを承認しましたか', '承認の経緯と対象')).toBe(true);
    expect(acceptSubjectHeading('Когда FDA одобрило Casgevy?', 'Когда FDA одобрило Casgevy')).toBe(false);
  });
});

describe('citation markers with no source behind them', () => {
  it('removes the marker instead of citing a reference that is not listed', () => {
    const sources = [
      { title: 'A', url: 'https://a.example' },
      { title: 'B', url: 'https://b.example' },
    ];
    const out = renumberCitations([{ content: 'First fact [2]. Second fact [7]. Third fact [1].' }], sources);
    expect(out.sections[0].content).toBe('First fact [1]. Second fact. Third fact [2].');
    expect(buildReferences(out.cited).split('\n')).toHaveLength(2);
  });
});

describe('structure score', () => {
  it('passes a short report that is only the answer and the closing note', () => {
    expect(scoreStructureComplete('# Title\n\n## Summary\nIt was 8 December 2023 [1].\n\n## References\n1. FDA\n\n## About this report\n1 source was read on 2 Oct 2026.')).toBe(1);
  });

  it('still requires the full set for a long report', () => {
    const long = `## Summary\n${'word '.repeat(100)}\n\n## Body\n${'word '.repeat(400)}\n\n## About this report\nx`;
    expect(scoreStructureComplete(long)).toBe(0);
  });

  it('reads headings from stored sections', () => {
    const markdown = storedSectionsToMarkdown([
      { title: 'Summary', content: 'Short answer.' },
      { title: 'About this report', content: '## About this report\n1 source was read.' },
    ]);
    expect(markdown).toBe('## Summary\nShort answer.\n\n## About this report\n1 source was read.');
    expect(scoreStructureComplete(markdown)).toBe(1);
  });
});

describe('material shown to the judge', () => {
  it('sends a passage whole when everything fits', () => {
    const text = `${'a'.repeat(3000)} LATE-EVIDENCE`;
    expect(digestRetrievedMaterial([{ label: 'S', text }])).toContain('LATE-EVIDENCE');
  });

  it('keeps the end of a passage when the budget is exceeded', () => {
    const chunks = Array.from({ length: 4 }, (_, i) => ({ label: `S${i}`, text: `${'a'.repeat(5000)} TAIL-${i}` }));
    const digest = digestRetrievedMaterial(chunks, 8000);
    for (let i = 0; i < 4; i += 1) expect(digest).toContain(`TAIL-${i}`);
    expect(digest.length).toBeLessThan(12000);
  });
});

describe('reference dates', () => {
  it('formats a database Date as a calendar day', () => {
    expect(isoDay(new Date('2023-12-08T00:00:00Z'))).toBe('2023-12-08');
    expect(isoDay('2023-12-08T10:00:00Z')).toBe('2023-12-08');
    expect(isoDay(null)).toBeNull();
    expect(isoDay('not a date')).toBeNull();
  });
});

describe('a planner length is not a user choice for section expansion', () => {
  it('is withheld from the contract expansion', () => {
    expect(userChosenWordTarget(105, 'planner')).toBeUndefined();
    expect(userChosenWordTarget(4000, 'user')).toBe(4000);
  });
});
