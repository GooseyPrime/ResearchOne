import { describe, expect, it } from 'vitest';
import {
  applySupplementalIngestNotifications,
  buildSupplementalIngestNotifications,
} from './supplementalIngestNotifications';

describe('buildSupplementalIngestNotifications', () => {
  it('returns info when files and URLs queue successfully', () => {
    const notes = buildSupplementalIngestNotifications({
      urlsQueued: 1,
      filesQueued: 2,
      filesAttempted: 2,
      jobIds: ['a', 'b', 'c'],
    });
    expect(notes.some((n) => n.severity === 'info' && n.message.includes('queued'))).toBe(true);
    expect(notes.some((n) => n.message.includes('1 URL(s)'))).toBe(true);
    expect(notes.some((n) => n.message.includes('2 file(s)'))).toBe(true);
    expect(notes.some((n) => n.message.includes('ingested'))).toBe(false);
  });

  it('returns error when filesAttempted exceeds filesQueued', () => {
    const notes = buildSupplementalIngestNotifications({
      urlsQueued: 0,
      filesQueued: 1,
      filesAttempted: 2,
      jobIds: ['a'],
      fileOutcomes: [
        { filename: 'a.pdf', status: 'queued', ingestionJobId: 'a' },
        { filename: 'b.pdf', status: 'failed', reason: 'Could not queue file for ingestion' },
      ],
    });
    expect(notes.some((n) => n.severity === 'error' && n.message.includes('could not be queued'))).toBe(true);
    expect(notes.some((n) => n.message.includes('b.pdf'))).toBe(true);
  });

  it('returns error for failed ingest job outcomes', () => {
    const notes = buildSupplementalIngestNotifications({
      urlsQueued: 0,
      filesQueued: 1,
      filesAttempted: 1,
      jobIds: ['job-1'],
      ingestOutcomes: [
        {
          jobId: 'job-1',
          status: 'failed',
          fileName: 'large.pdf',
          url: null,
          errorMessage: 'PDF has no extractable text',
        },
      ],
    });
    expect(notes.some((n) => n.message.includes('PDF has no extractable text'))).toBe(true);
  });

  it('returns empty array when ingest summary is undefined', () => {
    expect(buildSupplementalIngestNotifications(undefined)).toEqual([]);
  });

  it('does not claim a newly accepted request has already started', () => {
    const messages: string[] = [];
    applySupplementalIngestNotifications(undefined, (_severity, message) => messages.push(message));
    expect(messages).toEqual(['Request accepted — waiting for an available research worker...']);
    expect(messages[0]).not.toContain('Research started');
  });
});
