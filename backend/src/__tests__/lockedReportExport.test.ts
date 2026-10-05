/**
 * A report written with the citation lock exports as it was saved. Asserts on
 * the Markdown actually handed to Pandoc.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminQueryMock: vi.fn(),
  runPandocMock: vi.fn(),
  assignAliasesMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({ adminQuery: mocks.adminQueryMock }));
vi.mock('../services/formatting/evidenceAliaser', () => ({
  assignEvidenceAliases: mocks.assignAliasesMock,
  aliasesToCslBibliography: vi.fn().mockReturnValue([{ id: 'E1' }]),
  rewriteAliasesForPandoc: (body: string) => body,
}));
vi.mock('../services/formatting/pandocRunner', () => ({
  runPandoc: mocks.runPandocMock,
  PandocError: class PandocError extends Error {},
}));
vi.mock('../services/telemetry', () => ({
  runScope: { run: <T>(_ctx: unknown, fn: () => T): T => fn() },
}));

import { exportReport, pandocStyleFor } from '../services/formatting/exportOrchestrator';
import { sourcesByNumber, withReferenceStyle, type LockedCitationSourceRow } from '../services/formatting/lockedReportExport';

const META = [{ title: 'Nuclear construction costs by country', executive_summary: null, conclusion: null }];
const SECTIONS = [
  { title: 'Summary', content: 'Costs rose after 1979 [1]. French units took 65 to 90 months [2].', section_order: 1 },
  {
    title: 'References',
    content:
      '1. Jessica R. Lovering. Historical construction costs. Energy Policy. 1 Apr 2016. Journal article. https://doi.org/10.1/x\n2. wna.example.org. Economics of Nuclear Power. Web page. https://wna.example.org/economics Accessed 4 Oct 2026.',
    section_order: 2,
  },
  { title: 'About this report', content: '2 sources were read on 4 Oct 2026.', section_order: 3 },
];
const row = (number: number, over: Partial<LockedCitationSourceRow>): LockedCitationSourceRow => ({
  citation_text: `[${number}]`,
  title: null,
  authors: null,
  publication: null,
  published_at: null,
  url: null,
  original_filename: null,
  retrieval_timestamp: null,
  provider: null,
  ...over,
});
const CITATION_ROWS = [
  row(1, { title: 'Historical construction costs', authors: ['Lovering, Jessica R.'], publication: 'Energy Policy', published_at: new Date('2016-04-01T00:00:00Z'), url: 'https://doi.org/10.1/x', provider: 'crossref', kind: 'journal article' }),
  row(2, { title: 'Economics of Nuclear Power', url: 'https://wna.example.org/economics', retrieval_timestamp: '2026-10-04T20:00:00Z' }),
  row(1, { title: 'A copy of the same article on another site', url: 'https://copy.example.org/x' }),
];

/** Answers each query by what it asks for, so the order of queries is not part of the test. */
function answer(state: { locked: boolean; referenceStyle?: string | null; citationStyle?: string | null }) {
  mocks.adminQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("corpus_after->>'citationLock'")) {
      return [{ locked: state.locked ? 'true' : null, reference_style: state.referenceStyle ?? null, citation_style: state.citationStyle ?? null }];
    }
    if (sql.includes('FROM report_citations')) return CITATION_ROWS;
    if (sql.includes('FROM report_sections')) return SECTIONS;
    if (sql.includes('FROM reports')) return META;
    return [];
  });
}

const handed = () => mocks.runPandocMock.mock.calls[0]?.[0] as { markdown: string; cslJson: unknown[]; style: string };

beforeEach(() => {
  mocks.adminQueryMock.mockReset();
  mocks.runPandocMock.mockReset();
  mocks.assignAliasesMock.mockReset();
  mocks.assignAliasesMock.mockResolvedValue([]);
  mocks.runPandocMock.mockResolvedValue({ outputBuffer: Buffer.from(''), outputBytes: 0, durationMs: 1 });
});

describe('exporting a report written with the citation lock', () => {
  it('hands Pandoc the saved text with its own reference list, and no second one', async () => {
    answer({ locked: true, referenceStyle: 'numeric' });
    await exportReport({ reportId: 'r1', format: 'docx', style: 'numeric' });
    const { markdown, cslJson, style } = handed();
    expect(markdown).toContain('Costs rose after 1979 [1]. French units took 65 to 90 months [2].');
    expect(markdown.match(/^## References$/gm)).toHaveLength(1);
    expect(markdown).toContain('1. Jessica R. Lovering. Historical construction costs. Energy Policy. 1 Apr 2016. Journal article. https://doi.org/10.1/x');
    expect(markdown.trimEnd().endsWith('2 sources were read on 4 Oct 2026.')).toBe(true);
    // The export engine's aliases and bibliography play no part.
    expect(cslJson).toEqual([]);
    expect(mocks.assignAliasesMock).not.toHaveBeenCalled();
    expect(style).toBe('ieee');
  });

  it('writes only the reference list again when another style is asked for', async () => {
    answer({ locked: true, referenceStyle: 'numeric' });
    await exportReport({ reportId: 'r1', format: 'pdf', style: 'apa' });
    const { markdown, style } = handed();
    expect(style).toBe('apa');
    expect(markdown).toContain('Costs rose after 1979 [1]. French units took 65 to 90 months [2].');
    expect(markdown).toContain('1. Lovering, J. R. (2016, April 1). Historical construction costs. Energy Policy. https://doi.org/10.1/x');
    expect(markdown).toContain('2. wna.example.org. (n.d.). Economics of Nuclear Power. Retrieved October 4, 2026, from https://wna.example.org/economics');
    expect(markdown).not.toContain('Journal article.');
    // The first source cited under a number is its entry; a second stored copy is not.
    expect(markdown).not.toContain('copy.example.org');
    expect(markdown.match(/^## References$/gm)).toHaveLength(1);
  });

  it('keeps the saved list when the report was saved in the style asked for', async () => {
    answer({ locked: true, referenceStyle: 'apa' });
    await exportReport({ reportId: 'r1', format: 'md', style: 'apa' });
    expect(handed().markdown).toContain('1. Jessica R. Lovering. Historical construction costs.');
    expect(mocks.adminQueryMock.mock.calls.some((call) => String(call[0]).includes('FROM report_citations'))).toBe(false);
  });

  it('reads the saved style from the run when the report does not record one', async () => {
    answer({ locked: true, referenceStyle: null, citationStyle: 'mla' });
    await exportReport({ reportId: 'r1', format: 'md', style: 'mla' });
    expect(mocks.adminQueryMock.mock.calls.some((call) => String(call[0]).includes('FROM report_citations'))).toBe(false);
  });

  it('exports every other report the way it always did', async () => {
    answer({ locked: false });
    await exportReport({ reportId: 'r1', format: 'docx', style: 'apa' });
    const { markdown, cslJson, style } = handed();
    expect(mocks.assignAliasesMock).toHaveBeenCalledTimes(1);
    expect(cslJson).toEqual([{ id: 'E1' }]);
    expect(style).toBe('apa');
    // The engine appends its own heading for the bibliography it builds.
    expect(markdown.trimEnd().endsWith('## References')).toBe(true);
  });

  it('gives an unlocked report the numbered style file when the numbered default is asked for', async () => {
    answer({ locked: false });
    await exportReport({ reportId: 'r1', format: 'docx', style: 'numeric' });
    expect(handed().style).toBe('ieee');
    expect(pandocStyleFor('harvard')).toBe('harvard');
  });
});

describe('rebuilding the list from saved citations', () => {
  it('returns the sources in number order, first citation of each number', () => {
    const sources = sourcesByNumber(CITATION_ROWS);
    expect(sources?.map((source) => source.title)).toEqual(['Historical construction costs', 'Economics of Nuclear Power']);
    expect(sources?.[0].kind).toBe('journal article');
    expect(sources?.[0].date).toBe('2016-04-01');
    expect(sources?.[1].accessed).toBe('2026-10-04');
  });

  it('rebuilds nothing when the numbers are not exactly 1 to N', () => {
    expect(sourcesByNumber([row(1, { title: 'A' }), row(3, { title: 'C' })])).toBeNull();
    expect(sourcesByNumber([row(1, { title: 'A' }), { ...row(2, { title: 'B' }), citation_text: 'Smith 2020' }])).toBeNull();
  });

  it('leaves the sections alone when the list and the sources do not match', () => {
    const sources = sourcesByNumber(CITATION_ROWS);
    const oneEntry = [{ title: 'Summary', content: 'x [1].' }, { title: 'References', content: '1. Only one entry.' }];
    expect(withReferenceStyle(oneEntry, sources, 'apa')).toEqual({ sections: oneEntry, rebuilt: false });
    const noList = [{ title: 'Summary', content: 'x [1].' }];
    expect(withReferenceStyle(noList, sources, 'apa').rebuilt).toBe(false);
    // A report may open with a section of its own called References; that is not the generated list.
    const opening = [{ title: 'References', content: '1. a\n2. b' }, { title: 'Summary', content: 'x' }];
    expect(withReferenceStyle(opening, sources, 'apa').rebuilt).toBe(false);
  });
});
