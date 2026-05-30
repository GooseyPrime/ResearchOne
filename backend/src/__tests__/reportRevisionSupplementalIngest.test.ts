import { beforeEach, describe, expect, it, vi } from 'vitest';

const queryMock = vi.fn();
const fetchUrlForIngestMock = vi.fn();
const ingestionQueueAddMock = vi.fn();
const waitForIngestionJobsMock = vi.fn();

vi.mock('../db/pool', () => ({
  query: queryMock,
}));

vi.mock('../services/ingestion/ingestionService', () => ({
  fetchUrlForIngest: fetchUrlForIngestMock,
}));

vi.mock('../queue/queues', () => ({
  ingestionQueue: {
    add: ingestionQueueAddMock,
  },
}));

vi.mock('../services/discovery/discoveryOrchestrator', () => ({
  waitForIngestionJobs: waitForIngestionJobsMock,
}));

vi.mock('../services/ingestion/pdfExtractor', () => ({
  extractPdf: vi.fn(),
}));

vi.mock('../utils/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

describe('ingestSupplementalForRevision URL inline fetch', () => {
  beforeEach(() => {
    queryMock.mockReset();
    fetchUrlForIngestMock.mockReset();
    ingestionQueueAddMock.mockReset();
    waitForIngestionJobsMock.mockReset();
    queryMock.mockResolvedValue([]);
    ingestionQueueAddMock.mockResolvedValue(undefined);
    waitForIngestionJobsMock.mockResolvedValue(undefined);
  });

  it('inlines fetched URL text instead of async placeholder copy', async () => {
    fetchUrlForIngestMock.mockResolvedValue({
      content: 'Breaking news about quantum radar sensors from the primary source.',
      title: 'Quantum radar update',
    });

    const { ingestSupplementalForRevision, REVISION_URL_PLACEHOLDER_MARKER } = await import(
      '../services/research/reportRevisionSupplementalIngest'
    );

    const result = await ingestSupplementalForRevision({
      reportId: 'report-1',
      revisionRequestId: 'req-1',
      urls: ['https://example.com/article'],
      files: [],
    });

    expect(result.inlineContext).toContain('Breaking news about quantum radar');
    expect(result.inlineContext).not.toContain(REVISION_URL_PLACEHOLDER_MARKER);
    expect(result.attachments).toEqual([
      expect.objectContaining({
        kind: 'url',
        url: 'https://example.com/article',
        fetch_status: 'ok',
        extractedChars: expect.any(Number),
      }),
    ]);
  });

  it('records explicit URL fetch failure in inline context and attachment metadata', async () => {
    fetchUrlForIngestMock.mockRejectedValue(new Error('HTTP 403 Forbidden'));

    const { ingestSupplementalForRevision } = await import(
      '../services/research/reportRevisionSupplementalIngest'
    );

    const result = await ingestSupplementalForRevision({
      reportId: 'report-1',
      revisionRequestId: 'req-1',
      urls: ['https://example.com/blocked'],
      files: [],
    });

    expect(result.inlineContext).toContain('fetch failed');
    expect(result.inlineContext).toContain('HTTP 403 Forbidden');
    expect(result.attachments[0]).toMatchObject({
      kind: 'url',
      fetch_status: 'failed',
      error: 'HTTP 403 Forbidden',
    });
  });
});
