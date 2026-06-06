import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  STAGE_TEXT_INLINE_MAX_BYTES,
  buildSupplementalFileQueuePayload,
} from '../services/research/supplementalFileQueuePayload';

describe('buildSupplementalFileQueuePayload', () => {
  const stagingDir = path.join(os.tmpdir(), `r1-supplemental-test-${process.pid}`);

  afterEach(() => {
    vi.restoreAllMocks();
    if (fs.existsSync(stagingDir)) {
      for (const file of fs.readdirSync(stagingDir)) {
        fs.unlinkSync(path.join(stagingDir, file));
      }
      fs.rmdirSync(stagingDir);
    }
  });

  it('stages PDFs to disk instead of inline base64', () => {
    const pdfBuffer = Buffer.alloc(512 * 1024, 0x25);
    const result = buildSupplementalFileQueuePayload({
      originalname: 'report.pdf',
      mimetype: 'application/pdf',
      buffer: pdfBuffer,
    });

    expect(result).not.toBeNull();
    expect(result!.sourceType).toBe('pdf');
    expect(result!.fileData.stagedFilePath).toBeTruthy();
    expect(result!.fileData.text).toBeUndefined();
    expect(result!.fileData.fileBuffer).toBeUndefined();
    expect(fs.existsSync(result!.fileData.stagedFilePath!)).toBe(true);
  });

  it('inlines small text files', () => {
    const text = 'Hello supplemental corpus';
    const result = buildSupplementalFileQueuePayload({
      originalname: 'notes.txt',
      mimetype: 'text/plain',
      buffer: Buffer.from(text, 'utf8'),
    });

    expect(result).toEqual({
      sourceType: 'text',
      fileData: { text },
    });
  });

  it('stages large markdown files', () => {
    const large = 'x'.repeat(STAGE_TEXT_INLINE_MAX_BYTES + 1);
    const result = buildSupplementalFileQueuePayload({
      originalname: 'big.md',
      mimetype: 'text/markdown',
      buffer: Buffer.from(large, 'utf8'),
    });

    expect(result!.fileData.stagedFilePath).toBeTruthy();
    expect(result!.fileData.text).toBeUndefined();
  });

  it('accepts octet-stream PDFs by extension', () => {
    const result = buildSupplementalFileQueuePayload({
      originalname: 'scan.pdf',
      mimetype: 'application/octet-stream',
      buffer: Buffer.from('%PDF-1.4'),
    });

    expect(result?.sourceType).toBe('pdf');
    expect(result?.fileData.stagedFilePath).toBeTruthy();
  });
});
