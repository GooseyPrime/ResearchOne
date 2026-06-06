import { stageFileBuffer } from '../ingestion/uploadStaging';

/** Text/markdown files larger than this are staged to disk instead of inline in BullMQ jobs. */
export const STAGE_TEXT_INLINE_MAX_BYTES = 256 * 1024;

export type SupplementalSourceType = 'text' | 'pdf' | 'markdown';

export type SupplementalFileQueuePayload =
  | { text: string; fileBuffer?: never; stagedFilePath?: never }
  | { stagedFilePath: string; text?: never; fileBuffer?: never }
  | { fileBuffer: string; text?: never; stagedFilePath?: never };

export function classifySupplementalFile(
  originalname: string,
  mimetype: string
): SupplementalSourceType | null {
  const filename = originalname.toLowerCase();
  const mime = mimetype.toLowerCase();

  if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
    return 'pdf';
  }
  if (
    mime === 'text/markdown' ||
    mime === 'text/x-markdown' ||
    filename.endsWith('.md') ||
    filename.endsWith('.markdown')
  ) {
    return 'markdown';
  }
  if (mime === 'text/plain' || filename.endsWith('.txt')) {
    return 'text';
  }
  return null;
}

/**
 * Build ingestion queue file payload. PDFs and large files use stagedFilePath
 * (same path as corpus ingest) — never base64 in Redis for multi-MB PDFs.
 */
export function buildSupplementalFileQueuePayload(args: {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}): { sourceType: SupplementalSourceType; fileData: SupplementalFileQueuePayload } | null {
  const sourceType = classifySupplementalFile(args.originalname, args.mimetype);
  if (!sourceType) return null;

  const shouldStage =
    sourceType === 'pdf' || args.buffer.length > STAGE_TEXT_INLINE_MAX_BYTES;

  if (shouldStage) {
    const staged = stageFileBuffer(args.buffer, args.originalname);
    return {
      sourceType,
      fileData: { stagedFilePath: staged.stagedFilePath },
    };
  }

  return {
    sourceType,
    fileData: { text: args.buffer.toString('utf8') },
  };
}
