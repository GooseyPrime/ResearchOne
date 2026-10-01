/**
 * PDF and Word exports read report sections straight from the database, so a
 * report saved before labels were removed at generation time must still export
 * clean. Asserts on the Markdown actually handed to Pandoc.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import { exportReport } from '../services/formatting/exportOrchestrator';

beforeEach(() => {
  mocks.adminQueryMock.mockReset();
  mocks.runPandocMock.mockReset();
  mocks.adminQueryMock
    .mockResolvedValueOnce([{ title: 'Why rail projects run over budget', executive_summary: null, conclusion: null }])
    .mockResolvedValueOnce([
      {
        title: 'How the costs grew',
        content:
          'Costs reached $5.2 billion by 2012 [Strong_Evidence - Chunk 3], an allegation of diversion [Testimony - Chunk 11] remains unverified [Quantitative_Quality_Auditor].',
        section_order: 1,
      },
    ]);
  mocks.runPandocMock.mockResolvedValue({ outputBuffer: Buffer.from(''), outputBytes: 0, durationMs: 1 });
});

describe('report export', () => {
  it('cleans the summary and conclusion of a report that has no sections', async () => {
    mocks.adminQueryMock.mockReset();
    mocks.adminQueryMock
      .mockResolvedValueOnce([
        {
          title: 'Older report',
          executive_summary: 'Costs rose [Strong_Evidence - Chunk 3].',
          conclusion: 'Unclear (testimony).',
        },
      ])
      .mockResolvedValueOnce([]);

    await exportReport({ reportId: 'report-2', format: 'pdf', style: 'apa' } as Parameters<typeof exportReport>[0]);

    const markdown = mocks.runPandocMock.mock.calls[0]?.[0]?.markdown as string;
    expect(markdown).toContain('Costs rose [Chunk 3].');
    expect(markdown).not.toMatch(/strong_evidence|\(testimony\)/i);
  });

  it('hands Pandoc report text with no evidence-tier labels or internal step names', async () => {
    await exportReport({ reportId: 'report-1', format: 'pdf', style: 'apa' } as Parameters<typeof exportReport>[0]);

    const markdown = mocks.runPandocMock.mock.calls[0]?.[0]?.markdown as string;
    expect(markdown).toContain('Costs reached $5.2 billion by 2012 [Chunk 3]');
    expect(markdown).not.toMatch(/strong_evidence|testimony -|Quantitative_Quality_Auditor/i);
  });
});
