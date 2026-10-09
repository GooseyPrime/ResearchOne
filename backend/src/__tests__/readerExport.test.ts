/**
 * Slice 5, item 7: PDF, Word and Markdown exports render the section 2a
 * report. Asserts on the Markdown handed to Pandoc; Pandoc itself does not run.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  adminQueryMock: vi.fn(),
  runPandocMock: vi.fn(),
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
vi.mock('../services/eval/readerView', () => ({ authorityWordsForRun: async () => false }));

import { runWithFlags } from '../config/runFlags';
import { exportReport } from '../services/formatting/exportOrchestrator';
import { hasLegacyLabels, hasReferenceList, isChallengeSection, readerExportBody } from '../services/formatting/readerExport';
import { readerFacingLabelHits } from '../services/formatting/reportPresentation';

const TITLE = 'Why nuclear plants cost more in the United States';
const SECTIONS = [
  // A locked report stores its title as its first section, heading only.
  { title: TITLE, content: '', section_order: 0 },
  { title: 'Summary', content: 'Costs rose after 1979 [1] [Strong_Evidence]. Korea built in pairs [2] (Chunk 12).', section_order: 1 },
  { title: 'How the costs grew [Quantitative_Quality_Auditor]', content: 'Overnight costs reached about $8,000 per kilowatt [1][2]. An older note [Chunk 3] remains. Code `[Chunk 9]` is a sample.', section_order: 2 },
  { title: 'References', content: '1. IFP. Why does construction cost so much? 2023. https://ifp.org/a\n2. Vox. Why America abandoned nuclear power. 2016. https://vox.com/b', section_order: 3 },
  { title: 'About this report', content: '2 sources were read on 6 Oct 2026.', section_order: 4 },
  { title: 'Challenge', content: 'The strongest objection is that Korean figures are unaudited [2].', section_order: 5 },
  // Stored as the Challenge under another name.
  { title: 'Objections considered', content: 'A second objection [1].', section_order: 6, section_type: 'challenge' },
];

function answer(locked: boolean) {
  mocks.adminQueryMock.mockImplementation(async (sql: string) => {
    if (sql.includes("corpus_after->>'citationLock'")) return [{ locked: locked ? 'true' : null, reference_style: null, citation_style: null, run_id: 'run-1' }];
    // What the reading page's data is built from: the old mapper saved a passage and its source, and no number.
    if (sql.includes('FROM report_citations')) {
      return [{ section_id: 's2', chunk_id: 'chunk-c', claim_id: null, source_id: 'srcA', citation_text: null, citation_order: 0, chunk_quote: 'q', source_title: 'IFP', source_url: 'https://ifp.org/a', source_authors: null, source_publication: null, source_published_at: null, source_filename: null, source_kind: null, source_provider: null }];
    }
    if (sql.includes('FROM research_runs')) return [{ status: 'completed', gate_status: 'completed', retrieval_ids: ['chunk-a', 'chunk-b', 'chunk-c'] }];
    if (sql.includes('FROM claims')) return [];
    if (sql.includes('FROM report_sections')) return SECTIONS;
    if (sql.includes('FROM reports')) return [{ title: TITLE, executive_summary: null, conclusion: null }];
    return [];
  });
}
const handed = (): string => (mocks.runPandocMock.mock.calls[0]?.[0] as { markdown: string }).markdown;

beforeEach(() => {
  mocks.adminQueryMock.mockReset();
  mocks.runPandocMock.mockReset();
  mocks.runPandocMock.mockResolvedValue({ outputBuffer: Buffer.from(''), outputBytes: 0, durationMs: 1 });
});

describe.each([
  ['a report written with the citation lock', true],
  ['an older report', false],
])('exporting %s', (_name, locked) => {
  it.each(['pdf', 'docx', 'md'] as const)('hands Pandoc the section 2a report for %s: no never-list item, the reference list included', async (format) => {
    answer(locked);
    await exportReport({ reportId: 'r1', format, style: 'numeric' } as never);
    const markdown = handed();
    expect(readerFacingLabelHits(markdown)).toEqual([]);
    expect(markdown.replace(/`[^`]*`/g, '')).not.toMatch(/chunk|strong_evidence|quantitative_quality_auditor/i);
    // Numbered citations and the list they point to.
    expect(markdown).toContain('Costs rose after 1979 [1]. Korea built in pairs [2].');
    // An older passage label the saved citations map becomes its reader number; one they do not map is taken out.
    expect(markdown).toContain('An older note [1] remains.');
    // The Challenge has its own tab on the page and is not in the exported report, under either name.
    expect(markdown).not.toContain('strongest objection');
    expect(markdown).not.toContain('Objections considered');
    // One reference list, the report's own.
    expect(markdown.match(/^## References\s*$/gm)).toHaveLength(1);
    expect(markdown).toMatch(/## References\n\n1\. IFP\./);
    expect(markdown).toContain('2 sources were read on 6 Oct 2026.');
    // The title once: in the title block, not again as an empty heading.
    expect(markdown.match(new RegExp(TITLE, 'g'))).toHaveLength(1);
    // A code sample is the report's own content and is left as written.
    expect(markdown).toContain('`[Chunk 9]`');
  });
});

describe('the reader export is the only export', () => {
  const RETIRED = ['READER_VIEW_ENABLED', 'CITATION_LOCK_ENABLED', 'BASELINE_LAYER_ENABLED'] as const;
  const before = RETIRED.map((name) => process.env[name]);

  afterEach(() => {
    RETIRED.forEach((name, at) => {
      if (before[at] === undefined) delete process.env[name];
      else process.env[name] = before[at];
    });
  });

  it.each([true, false])("with the removed switches set to 'false' a report (locked: %s) is still exported as the reader sees it", async (locked) => {
    answer(locked);
    for (const name of RETIRED) process.env[name] = 'false';
    await runWithFlags({ READER_VIEW_ENABLED: false, CITATION_LOCK_ENABLED: false, BASELINE_LAYER_ENABLED: false }, () =>
      exportReport({ reportId: 'r1', format: 'pdf', style: 'numeric' } as never)
    );
    const markdown = handed();
    // The title once: the stored title heading is not printed under the title block.
    expect(markdown.match(new RegExp(TITLE, 'g'))).toHaveLength(1);
    expect(markdown.startsWith(`---\ntitle: ${JSON.stringify(TITLE)}\n---\n\n## Summary\n\n`)).toBe(true);
    // The Challenge is left out and no passage label is left in the prose.
    expect(markdown).not.toContain('strongest objection');
    expect(markdown).not.toContain('Objections considered');
    expect(markdown.replace(/`[^`]*`/g, '')).not.toMatch(/chunk/i);
    expect(readerFacingLabelHits(markdown)).toEqual([]);
    expect(markdown.match(/^## References\s*$/gm)).toHaveLength(1);
  });

  it('exports a report saved in the removed layout whole, under the headings a reader sees', async () => {
    const OLD_TITLE = 'Rail cost overruns';
    const OLD_SECTIONS = [
      { title: 'Executive Summary', content: 'Executive Summary\n\nThis report synthesizes evidence from 4 sources and 12 evidence chunks. Costs doubled [Chunk 1].', section_order: 0 },
      { title: 'Primary Evidence', content: 'Tunnelling drove the overrun [Chunk 2] [Strong_Evidence].', section_order: 1 },
      { title: 'Contested Zones', content: 'Contested Zones:\nThe current evidence set does not surface explicit contradiction pairs, but conclusions remain conditional on corpus coverage. Two audits differ on the baseline [Chunk 1].', section_order: 2 },
      { title: 'Challenges and Alternative Explanations', content: 'Inflation alone may explain it.', section_order: 3 },
      { title: 'Unresolved Questions', content: 'Whether the 2019 estimate was audited.', section_order: 4 },
      { title: 'Falsification Criteria', content: 'An audited baseline would settle it.', section_order: 5 },
    ];
    mocks.adminQueryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("corpus_after->>'citationLock'")) return [{ locked: null, reference_style: null, citation_style: null, run_id: 'run-1' }];
      if (sql.includes('FROM report_citations')) {
        return ['chunk-a', 'chunk-b'].map((chunk, at) => ({ section_id: 's1', chunk_id: chunk, claim_id: null, source_id: `src${at}`, citation_text: null, citation_order: at, chunk_quote: 'q', source_title: `Source ${at}`, source_url: `https://example.org/${at}`, source_authors: null, source_publication: null, source_published_at: null, source_filename: null, source_kind: null, source_provider: null }));
      }
      if (sql.includes('FROM research_runs')) return [{ status: 'completed', gate_status: 'completed', retrieval_ids: ['chunk-a', 'chunk-b'] }];
      if (sql.includes('FROM claims')) return [];
      if (sql.includes('FROM report_sections')) return OLD_SECTIONS;
      if (sql.includes('FROM reports')) return [{ title: OLD_TITLE, executive_summary: null, conclusion: null }];
      return [];
    });
    await exportReport({ reportId: 'r1', format: 'md', style: 'numeric' } as never);
    const markdown = handed();
    expect(markdown.match(new RegExp(OLD_TITLE, 'g'))).toHaveLength(1);
    // Every section of the report, in its stored order, under the reader's heading; the two challenge sections are left out.
    expect([...markdown.matchAll(/^## (.+)$/gm)].map((match) => match[1])).toEqual(['Summary', 'What the sources show', 'Where sources disagree', 'Open questions', 'References']);
    // The last heading is the one the export engine fills from the bibliography it builds.
    expect(markdown.trimEnd().endsWith('## References')).toBe(true);
    expect(markdown).not.toMatch(/Executive Summary|Primary Evidence|Contested Zones|Unresolved Questions|Falsification|Alternative Explanations/);
    expect(markdown).not.toContain('Inflation alone');
    expect(markdown).not.toContain('audited baseline would settle');
    // Machine sentences, labels and passage labels are gone; the numbers are the reader's, the same for one passage wherever it is cited.
    expect(markdown).not.toMatch(/synthesizes evidence|explicit contradiction pairs|chunk|strong_evidence/i);
    expect(readerFacingLabelHits(markdown)).toEqual([]);
    expect(markdown).toMatch(/^## Summary\n+Costs doubled \[1\]\.$/m);
    expect(markdown).toContain('Tunnelling drove the overrun [2].');
    expect(markdown).toMatch(/^## Where sources disagree\n+Two audits differ on the baseline \[1\]\.$/m);
    expect(markdown).toContain('## Open questions\n\nWhether the 2019 estimate was audited.');
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

  it('turns a mapped label into its reader number, once per source', () => {
    const numbers = new Map([[3, 2], [7, 2], [12, 1]]);
    expect(readerExportBody(null, '## S\n\nOne [Chunk 3]. Two (Chunks 3, 7). Three Chunk 12 here. Five [Chunk 99].', { legacyNumbers: numbers })).toBe('## S\n\nOne [2]. Two [2]. Three [1] here. Five.');
  });

  it('leaves out the Challenge by its title or by the titles it is told', () => {
    const body = '## Summary\n\nText.\n\n## Challenge: the strongest objections\n\nObjection.\n\n## Objections considered\n\nMore.';
    expect(readerExportBody(null, body)).toBe('## Summary\n\nText.\n\n## Objections considered\n\nMore.');
    expect(readerExportBody(null, body, { challengeTitles: ['Objections considered'] })).toBe('## Summary\n\nText.');
    expect(isChallengeSection({ title: 'Challenges of deployment' })).toBe(false);
    expect(hasLegacyLabels('Text `Chunk 3` only in code.')).toBe(false);
    expect(hasLegacyLabels('Text [Chunk 3].')).toBe(true);
  });

  it('knows whether a reference list is present', () => {
    expect(hasReferenceList('## Summary\n\nText [1].\n\n## References\n\n1. A.')).toBe(true);
    expect(hasReferenceList('## Summary\n\nText.')).toBe(false);
  });
});
