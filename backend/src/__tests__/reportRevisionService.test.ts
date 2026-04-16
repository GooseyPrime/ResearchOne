import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();

vi.mock('../db/pool', () => ({
  query: queryMock,
  withTransaction: vi.fn(),
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
});

describe('report revision history queries', () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it('returns revision history for a report', async () => {
    queryMock.mockResolvedValueOnce([{ id: 'rev-1', revision_number: 2 }]);
    const { listReportRevisions } = await import('../services/reasoning/reportRevisionService');
    const rows = await listReportRevisions('report-1');
    expect(rows).toHaveLength(1);
    expect(queryMock).toHaveBeenCalled();
  });
});
