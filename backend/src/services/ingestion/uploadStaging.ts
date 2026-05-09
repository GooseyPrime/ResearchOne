import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { retentionConfig } from '../../config/retention';

export interface StagedFile {
  stagedFilePath: string;
  stagedFileSha256: string;
  stagedFileSizeBytes: number;
  originalFileName: string;
}

function ensureStagingDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function validateStagedPathInside(filePath: string, stagingDir: string): boolean {
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(stagingDir);
  return resolved.startsWith(resolvedDir + path.sep);
}

export function stageFileBuffer(
  buffer: Buffer,
  originalFileName: string,
  stagingDir: string = retentionConfig.uploadStagingDir,
): StagedFile {
  ensureStagingDir(stagingDir);

  const hash = crypto.createHash('sha256').update(buffer).digest('hex');
  const uniqueId = crypto.randomUUID();
  const ext = path.extname(originalFileName) || '';
  const safeName = `${Date.now()}_${uniqueId}_${hash.slice(0, 16)}${ext}`;
  const stagedFilePath = path.join(stagingDir, safeName);

  if (!validateStagedPathInside(stagedFilePath, stagingDir)) {
    throw new Error('Staged file path escapes upload staging directory');
  }

  fs.writeFileSync(stagedFilePath, buffer);

  return {
    stagedFilePath,
    stagedFileSha256: hash,
    stagedFileSizeBytes: buffer.length,
    originalFileName,
  };
}

export function readStagedFile(filePath: string, stagingDir: string = retentionConfig.uploadStagingDir): Buffer {
  if (!validateStagedPathInside(filePath, stagingDir)) {
    throw new Error('Staged file path escapes upload staging directory');
  }
  return fs.readFileSync(filePath);
}

export function cleanupStagedFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // best-effort cleanup
  }
}
