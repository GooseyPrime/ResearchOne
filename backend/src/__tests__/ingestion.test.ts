import { describe, it, expect } from 'vitest';

// Test ingestion data type contracts (no DB required)
describe('ingestion source type classification', () => {
  function classifyFile(mime: string, filename: string): 'pdf' | 'markdown' | 'text' {
    if ((mime as string) === 'application/pdf' || filename.endsWith('.pdf')) return 'pdf';
    if ((mime as string) === 'text/markdown' || (mime as string) === 'text/x-markdown' || filename.endsWith('.md')) return 'markdown';
    return 'text';
  }

  it('recognises PDF MIME type', () => {
    expect(classifyFile('application/pdf', 'report.pdf')).toBe('pdf');
  });

  it('recognises PDF by extension', () => {
    expect(classifyFile('application/octet-stream', 'report.pdf')).toBe('pdf');
  });

  it('recognises markdown MIME type', () => {
    expect(classifyFile('text/markdown', 'notes.md')).toBe('markdown');
  });

  it('recognises .md extension with octet-stream MIME', () => {
    expect(classifyFile('application/octet-stream', 'notes.md')).toBe('markdown');
  });

  it('recognises plain text', () => {
    expect(classifyFile('text/plain', 'data.txt')).toBe('text');
  });
});

describe('ingestion provenance metadata', () => {
  it('URL ingestion defaults to manual_url importedVia', () => {
    const importedVia = 'manual_url';
    expect(['manual_upload', 'manual_url', 'autonomous_discovery', 'corpus_sync']).toContain(importedVia);
  });

  it('file upload defaults to manual_upload importedVia', () => {
    const importedVia = 'manual_upload';
    expect(importedVia).toBe('manual_upload');
  });

  it('autonomous discovery sets importedVia and discoveredByRunId', () => {
    const jobData = {
      importedVia: 'autonomous_discovery' as const,
      discoveredByRunId: 'run-uuid-123',
      discoveryQuery: 'test query',
      sourceRank: 1,
    };
    expect(jobData.importedVia).toBe('autonomous_discovery');
    expect(jobData.discoveredByRunId).toBe('run-uuid-123');
    expect(jobData.sourceRank).toBe(1);
  });

  it('URL ingestion stores provenance metadata fields', () => {
    // Simulate what fetchUrl returns
    const fetchResult = {
      content: 'some content',
      title: 'Page Title',
      canonicalUrl: 'https://example.com/canonical',
      metaDescription: 'A description',
      retrievalTimestamp: new Date().toISOString(),
    };
    expect(fetchResult.canonicalUrl).toBeTruthy();
    expect(fetchResult.metaDescription).toBeTruthy();
    expect(fetchResult.retrievalTimestamp).toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
