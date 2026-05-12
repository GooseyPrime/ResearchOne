/**
 * Storage abstraction for rendered export files.
 *
 * Three implementations behind one interface:
 *   - 'local':  writes under EXPORTS_DIR (see config.exports.dir) + `/exports/<id>.<ext>` URL
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
/** Align with `app.use('/exports', static(config.exports.dir))` unless overridden. */
const LOCAL_DIR = process.env.EXPORT_LOCAL_DIR ?? config.exports.dir;

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
  const path = join(LOCAL_DIR, `${args.exportId}.${args.format}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, args.buffer);
  // Served by Express static at `/exports` (see api/app.ts).
  return `/exports/${args.exportId}.${args.format}`;
}
