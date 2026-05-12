/**
 * Storage abstraction for rendered export files.
 *
 * Three implementations behind one interface:
 *   - 'local':  writes under EXPORTS_DIR; download via authenticated
 *               `GET /api/reports/exports/:id/download` (not public static).
 *   - 's3':     uploads to S3 bucket, returns signed URL with TTL
 *   - 'r2':     same as S3 but Cloudflare R2 endpoint
 *
 * Selected via EXPORT_STORAGE_BACKEND env (default: 'local' for dev).
 *
 * The signed URL TTL is short (default 1h) — long enough for a user
 * to click download from the polling response, short enough that a
 * leaked URL doesn't grant indefinite access.
 */
import { writeFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { config } from '../../config';

export interface UploadArgs {
  exportId: string;
  reportId: string;
  format: string;
  buffer: Buffer;
}

const BACKEND = process.env.EXPORT_STORAGE_BACKEND ?? 'local';
/** On-disk directory for `EXPORT_STORAGE_BACKEND=local` (see `resolveLocalExportDiskPath`). */
const LOCAL_DIR = process.env.EXPORT_LOCAL_DIR ?? config.exports.dir;

/** Absolute path to a vendored report export file on disk (local backend only). */
export function resolveLocalExportDiskPath(exportId: string, format: string): string {
  return join(LOCAL_DIR, `${exportId}.${format}`);
}

export async function uploadExportOutput(args: UploadArgs): Promise<string> {
  switch (BACKEND) {
    case 'local':
      return uploadLocal(args);
    case 's3':
    case 'r2':
      // Stub — implementations depend on your existing AWS SDK usage.
      // For initial rollout, 'local' is correct; promote to 's3' when
      // you have a bucket + IAM role provisioned. The interface is
      // already in place.
      throw new Error(`EXPORT_STORAGE_BACKEND=${BACKEND} not yet implemented`);
    default:
      throw new Error(`unknown EXPORT_STORAGE_BACKEND: ${BACKEND}`);
  }
}

async function uploadLocal(args: UploadArgs): Promise<string> {
  const path = resolveLocalExportDiskPath(args.exportId, args.format);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.buffer);
  // Auth-gated download — see `GET /api/reports/exports/:exportId/download`.
  return `/api/reports/exports/${args.exportId}/download`;
}
