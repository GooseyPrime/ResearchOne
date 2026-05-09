import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import {
  stageFileBuffer,
  readStagedFile,
  validateStagedPathInside,
  cleanupStagedFile,
} from '../services/ingestion/uploadStaging';

let tempDir: string;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'staging-test-'));
});

afterEach(() => {
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('stageFileBuffer', () => {
  it('writes file to staging dir and returns correct metadata', () => {
    const buffer = Buffer.from('test file content');
    const result = stageFileBuffer(buffer, 'test-doc.pdf', tempDir);

    expect(result.stagedFilePath).toContain(tempDir);
    expect(result.originalFileName).toBe('test-doc.pdf');
    expect(result.stagedFileSizeBytes).toBe(buffer.length);
    expect(fs.existsSync(result.stagedFilePath)).toBe(true);
  });

  it('returns correct sha256', () => {
    const crypto = require('crypto');
    const buffer = Buffer.from('hash me');
    const expectedHash = crypto.createHash('sha256').update(buffer).digest('hex');
    const result = stageFileBuffer(buffer, 'hash.txt', tempDir);
    expect(result.stagedFileSha256).toBe(expectedHash);
  });
});

describe('readStagedFile', () => {
  it('reads the staged file', () => {
    const content = 'read me back';
    const buffer = Buffer.from(content);
    const staged = stageFileBuffer(buffer, 'readable.txt', tempDir);
    const readBack = readStagedFile(staged.stagedFilePath, tempDir);
    expect(readBack.toString()).toBe(content);
  });
});

describe('validateStagedPathInside', () => {
  it('rejects path traversal (../../etc/passwd)', () => {
    const malicious = path.join(tempDir, '..', '..', 'etc', 'passwd');
    expect(validateStagedPathInside(malicious, tempDir)).toBe(false);
  });

  it('accepts valid paths inside staging dir', () => {
    const valid = path.join(tempDir, 'somefile.txt');
    expect(validateStagedPathInside(valid, tempDir)).toBe(true);
  });

  it('rejects paths outside staging dir', () => {
    expect(validateStagedPathInside('/tmp/other/file.txt', tempDir)).toBe(false);
  });
});

describe('cleanupStagedFile', () => {
  it('removes the file', () => {
    const buffer = Buffer.from('delete me');
    const staged = stageFileBuffer(buffer, 'delete.txt', tempDir);
    expect(fs.existsSync(staged.stagedFilePath)).toBe(true);

    cleanupStagedFile(staged.stagedFilePath);
    expect(fs.existsSync(staged.stagedFilePath)).toBe(false);
  });

  it('does not throw for non-existent file', () => {
    expect(() => cleanupStagedFile(path.join(tempDir, 'nope.txt'))).not.toThrow();
  });
});
