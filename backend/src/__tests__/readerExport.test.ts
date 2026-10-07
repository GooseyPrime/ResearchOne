/**
 * Slice 5, item 7: PDF, Word and Markdown exports render the section 2a
 * report. Asserts on the Markdown handed to Pandoc; Pandoc itself does not run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminQueryMock: vi.fn(),
  runPandocMock: vi.fn(),
  readerViewMock: vi.fn(),
}));

vi.mock('../db/pool', () => ({ adminQuery: mocks.adminQueryMock }));
vi.mock('../services/formatting/evidenceAliaser', () => ({
  assignEvidenceAliases: vi.fn().mockResolvedValue([]),
  aliasesToCslBibliography: vi.fn().mockReturnValue([]),
  rewriteAliasesForPandoc: (body: string) => body,
}));
vi.mock('../services/formatting/pandocRunner', () => ({
  runPandoc: mocks.runPandocMock,
  PandocError: class PandocError extends Error {},
}));
vi.mock('../services/telemetry', () => ({
  runScope: { run: <T>(_ctx: unknown, fn: () => T): T => fn() },
}));
vi.mock('../services/eval/readerView', () => ({ readerViewForRun: mocks.readerViewMock }));

import { exportReport } from '../services/formatting/exportOrchestrator';
import { hasReferenceList, readerExportBody } from '../services/formatting/readerExport';
import { readerFacingLabelHits } from '../services/formatting/reportPresentation';

const TITLE = 'Why nuclear plants cost more in the United States';
const SECTIONS = [
  // A locked report stores its title as its first section, heading only.
  { title: TITLE, content: '', section_order: 0 },
  { title: 'Summary', content: 'Costs rose after 1979 [1] [Strong_Evidence]. Korea built in pairs [2] (Chunk 12).', section_order: 1 },
  { title: 'How the costs grew [Quantitative_Quality_Auditor]', content: 'Overnight costs reached about $8,000 per kilowatt [1][2]. An older note [Chunk 3] remains. Code `[Chunk 9]` is a sample.', section_order: 2 },
  { title: 'References', content: '1. IFP. Why does construction cost so much? 2023. https://ifp.org/a\n2. Vox. Why America abandoned nuclear power. 2016. https://vox.com/b', section_order: 3 },
  { title: 'About this report', content: '2 sources were read on 6 Oct 2026.', section_order: 4 },
];

function answer(locked: boolean) {
  mocks.adminQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("corpus_after->>'citationLock'")) return [{ locked: locked ? 'true' : null, reference_style: null, citation_style: null, run_id: 'run-1' }];
    if (sql.includes('FROM report_sections')) return SECTIONS;
    if (sql.includes('FROM reports')) return [{ title: TITLE, executive_summary: null, conclusion: null }];
    return [];
  });
}
const handed = (): string => (mocks.runPandocMock.mock.calls[0]?.[0] as { markdown: string }).markdown;

beforeEach(() => {
  mocks.adminQueryMock.mockReset();
  mocks.runPandocMock.mockReset();
  mocks.readerViewMock.mockReset();
  mocks.runPandocMock.mockResolvedValue({ outputBuffer: Buffer.from(''), outputBytes: 0, durationMs: 1 });
});

describe.each([
  ['a report written with the citation lock', true],
  ['an older report', false],
])('exporting %s in the reader view', (_name, locked) => {
  it.each(['pdf', 'docx', 'md'] as const)('hands Pandoc the section 2a report for %s: no never-list item, the reference list included', async (format) => {
    answer(locked);
    mocks.readerViewMock.mockResolvedValue(true);
    await exportReport({ reportId: 'r1', format, style: 'numeric' } as never);
    const markdown = handed();
    expect(mocks.readerViewMock).toHaveBeenCalledWith('run-1');
    expect(readerFacingLabelHits(markdown)).toEqual([]);
    expect(markdown.replace(/`[^`]*`/g, '')).not.toMatch(/chunk|strong_evidence|quantitative_quality_auditor/i);
    // Numbered citations and the list they point to.
    expect(markdown).toContain('Costs rose after 1979 [1]. Korea built in pairs [2].');
    expect(markdown).toMatch(/## References\n\n1\. IFP\./);
    expect(markdown).toContain('2 sources were read on 6 Oct 2026.');
    // The title once: in the title block, not again as an empty heading.
    expect(markdown.match(new RegExp(TITLE, 'g'))).toHaveLength(1);
    // A code sample is the report's own content and is left as written.
    expect(markdown).toContain('`[Chunk 9]`');
  });
});

describe('S1: with the reader view off an export is what it was before', () => {
  it('keeps the stored title heading and applies only the clean-up exports already had', async () => {
    answer(true);
    mocks.readerViewMock.mockResolvedValue(false);
    await exportReport({ reportId: 'r1', format: 'pdf', style: 'numeric' } as never);
    const markdown = handed();
    expect(markdown.match(new RegExp(TITLE, 'g'))).toHaveLength(2);
    expect(markdown).toContain(`## ${TITLE}\n\n\n\n## Summary`);
  });
});

describe('readerExportBody', () => {
  it('drops only a heading that is the title with nothing under it', () => {
    expect(readerExportBody('A Title', '## A Title\n\n\n\n## Summary\n\nText.')).toBe('## Summary\n\nText.');
    expect(readerExportBody('A Title', '## A Title\n\nIt has a body.\n\n## Summary\n\nText.')).toContain('## A Title\n\nIt has a body.');
    expect(readerExportBody(null, '## Summary\n\nText.')).toBe('## Summary\n\nText.');
  });

  it('takes out passage labels in every form and tidies what they leave', () => {
    expect(readerExportBody(null, '## S\n\nOne [Chunk 3]. Two (Chunks 3, 7). Three Chunk 12 here. Four [1].')).toBe('## S\n\nOne. Two. Three here. Four [1].');
  });

  it('knows whether a reference list is present', () => {
    expect(hasReferenceList('## Summary\n\nText [1].\n\n## References\n\n1. A.')).toBe(true);
    expect(hasReferenceList('## Summary\n\nText.')).toBe(false);
  });
});
