import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  query: queryMock,
  withTransaction: vi.fn(),
}));

vi.mock('../services/openrouter/openrouterService', () => ({
  callRoleModel: vi.fn(),
  SYSTEM_PROMPTS: {},
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('report revision helpers', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('finds multi-location impacted sections', async () => {
    const { locateAffectedSections } = await import('../services/reasoning/reportRevisionService');
    const sections = [
      { section_type: 'executive_summary', title: 'Executive Summary', content: 'Quantum radar conclusion overview' },
      { section_type: 'reasoning', title: 'Reasoning', content: 'Mechanism analysis for quantum radar effects' },
      { section_type: 'conclusion', title: 'Conclusion', content: 'Final quantum radar assessment' },
    ] as Array<{ section_type: string; title: string; content: string }>;

    const hits = locateAffectedSections({
      sections: sections as never,
      request: 'Update quantum radar conclusions and summary',
      targetTerms: ['quantum radar'],
    });

    expect(hits).toContain('executive_summary');
    expect(hits).toContain('conclusion');
  });

  it('applies global terminology changes across content', async () => {
    const { applyGlobalTerminologyChange } = await import('../services/reasoning/reportRevisionService');
    const updated = applyGlobalTerminologyChange(
      'Use UAP terminology here. Earlier UAP references remain.',
      'UAP',
      'anomalous aerospace object'
    );
    expect(updated).toContain('anomalous aerospace object terminology');
    expect(updated).not.toContain('UAP references');
  });

  it('places inserted content in inferred section location', async () => {
    const { inferInsertionIndex } = await import('../services/reasoning/reportRevisionService');
    const index = inferInsertionIndex(
      ['executive_summary', 'evidence_ledger', 'reasoning', 'synthesis'],
      { title: 'New Mechanism Section' }
    );
    expect(index).toBe(2);
  });

  it('flags consistency issues when conclusions/falsification are missing', async () => {
    const { basicConsistencyChecks } = await import('../services/reasoning/reportRevisionService');
    const issues = basicConsistencyChecks([
      { section_type: 'executive_summary', content: 'ok' },
      { section_type: 'reasoning', content: 'ok' },
    ] as never);
    expect(issues).toContain('missing_conclusion');
    expect(issues).toContain('missing_falsification_criteria');
  });

  it('does not flag missing_falsification_criteria for descriptive (non-adjudicative) intents', async () => {
    const { basicConsistencyChecks } = await import('../services/reasoning/reportRevisionService');
    const sections = [
      { section_type: 'executive_summary', content: 'Summary of findings' },
      { section_type: 'conclusion', content: 'Conclusions here' },
      { section_type: 'findings', content: 'Key findings' },
    ] as never;
    // Descriptive intents should NOT require falsification_criteria
    const descriptiveIssues = basicConsistencyChecks(sections, 'opportunity_discovery');
    expect(descriptiveIssues).not.toContain('missing_falsification_criteria');
    // Adjudicative intents still require falsification_criteria
    const adjudicativeIssues = basicConsistencyChecks(sections, 'adjudication');
    expect(adjudicativeIssues).toContain('missing_falsification_criteria');
    // Legacy (no intentId) still requires falsification_criteria for backward compat
    const legacyIssues = basicConsistencyChecks(sections, undefined);
    expect(legacyIssues).toContain('missing_falsification_criteria');
  });
});

describe('report revision history queries', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns revision history for a report', async () => {
    queryMock
      .mockResolvedValueOnce([{ root_id: 'root-1' }])
      .mockResolvedValueOnce([{ id: 'rev-1', revision_number: 2 }]);
    const { listReportRevisions } = await import('../services/reasoning/reportRevisionService');
    const rows = await listReportRevisions('report-1');
    expect(rows).toHaveLength(1);
    expect(queryMock).toHaveBeenCalled();
  });
});

describe('citations carried into a revision', () => {
  const row = (over: Record<string, unknown>) => ({
    section_id: 's1',
    chunk_id: 'chunk-1',
    claim_id: null,
    source_id: 'source-1',
    citation_text: '[1]',
    chunk_quote: 'a quote',
    citation_order: 1,
    evidence_tier: 'inference',
    stance: 'supports',
    ...over,
  });
  const baseSections = [
    { id: 's1', section_type: 'body', title: 'History', content: 'The bridge opened in 1932 [1]. It was repainted in 1950 [2].' },
    { id: 's2', section_type: 'body', title: 'Use', content: 'Traffic doubled by 1960 [1].' },
    {
      id: 's3',
      section_type: 'body',
      title: 'References',
      content: '1. City archive. Bridge records.\n2. Works department. Paint log.',
    },
  ];
  const baseCitations = [
    row({ section_id: 's1', citation_text: '[1]', citation_order: 1, chunk_id: 'chunk-1', source_id: 'source-1', chunk_quote: 'opened in 1932' }),
    row({ section_id: 's1', citation_text: '[2]', citation_order: 2, chunk_id: 'chunk-2', source_id: 'source-2', chunk_quote: 'repainted in 1950' }),
    row({ section_id: 's2', citation_text: '[1]', citation_order: 3, chunk_id: 'chunk-3', source_id: 'source-1', chunk_quote: 'traffic doubled' }),
  ];

  it('keeps a locked citation only on an unchanged sentence, on its own section, renumbered in reading order', async () => {
    const { carryCitationsIntoRevision } = await import('../services/reasoning/reportRevisionService');
    const revised = [
      { ...baseSections[0], content: 'The bridge was finished early [1]. It was repainted in 1950 [2].' },
      baseSections[1],
      baseSections[2],
    ];
    const out = carryCitationsIntoRevision({ baseSections, baseCitations, revisedSections: revised, lockRecorded: true });
    expect(out.locked).toBe(true);
    expect(out.removed).toBe(1);
    // The rewritten sentence loses its number; the paint log is now the first source cited.
    expect(out.sections[0].content).toBe('The bridge was finished early. It was repainted in 1950 [1].');
    expect(out.sections[1].content).toBe('Traffic doubled by 1960 [2].');
    expect(out.sections[0].section_type).toBe('body');
    expect(out.citations.map((entry) => [entry.sectionKey, entry.row.citation_text, entry.row.citation_order, entry.row.chunk_id, entry.row.chunk_quote])).toEqual([
      ['s1', '[1]', 1, 'chunk-2', 'repainted in 1950'],
      ['s2', '[2]', 2, 'chunk-3', 'traffic doubled'],
    ]);
  });

  it('does not carry a locked citation whose passage is no longer stored', async () => {
    const { carryCitationsIntoRevision } = await import('../services/reasoning/reportRevisionService');
    const citations = [baseCitations[0], row({ ...baseCitations[1], chunk_id: null }), baseCitations[2]];
    const out = carryCitationsIntoRevision({ baseSections, baseCitations: citations, revisedSections: baseSections, lockRecorded: true });
    expect(out.citations.map((entry) => entry.row.chunk_id)).toEqual(['chunk-1', 'chunk-3']);
    expect(out.sections[0].content).toBe('The bridge opened in 1932 [1]. It was repainted in 1950.');
  });

  it('drops a citation whose passage was deleted while the revision was running', async () => {
    const { carryCitationsIntoRevision, withoutDeletedPassages } = await import('../services/reasoning/reportRevisionService');
    // chunk-2 was there when the citations were read and is gone at save time.
    const rows = withoutDeletedPassages(baseCitations, new Set(['chunk-1', 'chunk-3']));
    expect(rows.map((entry) => entry.chunk_id)).toEqual(['chunk-1', null, 'chunk-3']);
    expect(baseCitations[1].chunk_id).toBe('chunk-2');
    const out = carryCitationsIntoRevision({ baseSections, baseCitations: rows, revisedSections: baseSections, lockRecorded: true });
    expect(out.citations.map((entry) => entry.row.chunk_id)).toEqual(['chunk-1', 'chunk-3']);
    expect(out.citations.map((entry) => entry.row.citation_order)).toEqual([1, 2]);
    expect(out.sections[0].content).toBe('The bridge opened in 1932 [1]. It was repainted in 1950.');
  });

  it('re-reads the cited passages inside the save and holds them until it commits', async () => {
    const { readFileSync } = await import('node:fs');
    const source = readFileSync('src/services/reasoning/reportRevisionService.ts', 'utf8');
    const save = source.slice(source.indexOf('await withTransaction(async (client) => {'));
    const check = save.indexOf('SELECT id FROM chunks WHERE id = ANY($1::uuid[]) FOR SHARE');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(save.indexOf('INSERT INTO report_sections'));
    expect(save.slice(check, save.indexOf('INSERT INTO report_sections'))).toMatch(/withoutDeletedPassages\(baseCitations, present\)/);
  });

  it('treats a report as locked from its record even when it cites nothing', async () => {
    const { carryCitationsIntoRevision } = await import('../services/reasoning/reportRevisionService');
    const plain = [{ id: 's1', section_type: 'body', title: 'History', content: 'Nothing was cited.' }];
    const revised = [{ ...plain[0], content: 'Now it claims a source [1].' }];
    const locked = carryCitationsIntoRevision({ baseSections: plain, baseCitations: [], revisedSections: revised, lockRecorded: true });
    expect(locked.sections[0].content).toBe('Now it claims a source.');
    const open = carryCitationsIntoRevision({ baseSections: plain, baseCitations: [], revisedSections: revised, lockRecorded: false });
    expect(open.locked).toBe(false);
    expect(open.sections[0].content).toBe('Now it claims a source [1].');
  });

  it('leaves the rows of a report written without the lock on the sections they came from', async () => {
    const { carryCitationsIntoRevision } = await import('../services/reasoning/reportRevisionService');
    const loose = [
      row({ section_id: 's1', citation_text: 'A claim about the bridge.', citation_order: null }),
      row({ section_id: 's2', citation_text: 'A claim about traffic.', citation_order: null }),
      row({ section_id: null, citation_text: 'Unplaced.', citation_order: null }),
    ];
    const revised = [{ ...baseSections[0], content: 'Rewritten [Chunk 1].' }, baseSections[1]];
    const out = carryCitationsIntoRevision({ baseSections, baseCitations: loose, revisedSections: revised, lockRecorded: false });
    expect(out.locked).toBe(false);
    expect(out.sections).toBe(revised);
    expect(out.citations.map((entry) => entry.sectionKey)).toEqual(['s1', 's2']);
  });
});
