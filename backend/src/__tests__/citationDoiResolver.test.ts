import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { query, withTransaction } from '../db/pool';
import { updateCitationDoiStatus } from '../services/verification/citationDoiResolver';

// Mock the database pool
vi.mock('../db/pool');

describe('citationDoiResolver', () => {
  beforeEach(() => {
    process.env.DOI_RESOLVE_ENABLED = 'true';

    // withTransaction runs the callback and delegates queries to the mocked pool
    vi.mocked(withTransaction).mockImplementation(async (work) => {
      const client = { query: vi.mocked(query) };
      return work(client as unknown as import('pg').PoolClient);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.DOI_RESOLVE_ENABLED;
  });

  it('should update citation DOI status when DOI resolution is enabled', async () => {
    // Mock the database queries
    const mockQuery = vi.mocked(query);

    // Mock return for citations query
    mockQuery.mockResolvedValueOnce([
      { id: 'cit-1', source_id: 'src-1', chunk_id: 'chunk-1' }
    ] as any);

    // Mock return for chunks query
    mockQuery.mockResolvedValueOnce([
      { id: 'chunk-1', source_url: 'https://doi.org/10.1000/test' }
    ] as any);

    // Mock DOI resolution
    vi.spyOn(await import('../services/verification/doiResolve'), 'resolveDois').mockResolvedValue([
      { doi: '10.1000/test', resolveStatus: 'resolved' }
    ]);

    vi.spyOn(await import('../services/verification/doiResolve'), 'fetchCrossrefMetadata').mockResolvedValue({
      retracted: false,
      corrected: false,
      withdrawn: false,
    });

    await updateCitationDoiStatus('report-1');

    // Verify that the update query was called by checking the mock calls
    const updateCalls = mockQuery.mock.calls.filter(call => call[0].includes('UPDATE report_citations'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(expect.arrayContaining(['resolved', null, 'cit-1']));
  });

  it('should handle retracted citations', async () => {
    const mockQuery = vi.mocked(query);

    // Mock return for citations query
    mockQuery.mockResolvedValueOnce([
      { id: 'cit-1', source_id: 'src-1', chunk_id: 'chunk-1' }
    ] as any);

    // Mock return for chunks query
    mockQuery.mockResolvedValueOnce([
      { id: 'chunk-1', source_url: 'https://doi.org/10.1000/retracted' }
    ] as any);

    // Mock DOI resolution
    vi.spyOn(await import('../services/verification/doiResolve'), 'resolveDois').mockResolvedValue([
      { doi: '10.1000/retracted', resolveStatus: 'resolved' }
    ]);

    vi.spyOn(await import('../services/verification/doiResolve'), 'fetchCrossrefMetadata').mockResolvedValue({
      retracted: true,
      retractionNotice: 'This paper has been retracted due to errors',
      corrected: false,
      withdrawn: false,
    });

    await updateCitationDoiStatus('report-1');

    // Verify that the update query was called with retracted status
    const updateCalls = mockQuery.mock.calls.filter(call => call[0].includes('UPDATE report_citations'));
    expect(updateCalls).toHaveLength(1);
    expect(updateCalls[0][1]).toEqual(expect.arrayContaining(['retracted', 'This paper has been retracted due to errors', 'cit-1']));
  });

  it('should handle column not existing (deploy skew)', async () => {
    const mockQuery = vi.mocked(query);

    // Mock return for citations query
    mockQuery.mockResolvedValueOnce([
      { id: 'cit-1', source_id: 'src-1', chunk_id: 'chunk-1' }
    ] as any);

    // Mock return for chunks query
    mockQuery.mockResolvedValueOnce([
      { id: 'chunk-1', source_url: 'https://doi.org/10.1000/test' }
    ] as any);

    // Mock DOI resolution
    vi.spyOn(await import('../services/verification/doiResolve'), 'resolveDois').mockResolvedValue([
      { doi: '10.1000/test', resolveStatus: 'resolved' }
    ]);

    vi.spyOn(await import('../services/verification/doiResolve'), 'fetchCrossrefMetadata').mockResolvedValue({
      retracted: false,
      corrected: false,
      withdrawn: false,
    });

    // Mock update query to throw 42703 error (column does not exist)
    mockQuery.mockImplementation((sql: string, _params: any) => {
      if (sql.includes('UPDATE report_citations')) {
        return Promise.reject({ code: '42703' }); // undefined_column
      }
      return Promise.resolve([] as any);
    });

    // Should not throw, just log a warning
    await expect(updateCitationDoiStatus('report-1')).resolves.not.toThrow();
  });

  it('should skip when DOI resolution is disabled', async () => {
    process.env.DOI_RESOLVE_ENABLED = 'false';
    const mockQuery = vi.mocked(query);

    await updateCitationDoiStatus('report-1');

    // Should not make any queries since DOI resolution is disabled
    expect(mockQuery).toHaveBeenCalledTimes(0);
  });

  it('should handle no citations found', async () => {
    const mockQuery = vi.mocked(query);

    // Mock return for citations query - empty
    mockQuery.mockResolvedValueOnce([] as any);

    await updateCitationDoiStatus('report-1');

    // Should only query for citations, then return early
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
