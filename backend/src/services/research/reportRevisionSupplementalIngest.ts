import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';
import { waitForIngestionJobs } from '../discovery/discoveryOrchestrator';
import { extractPdf } from '../ingestion/pdfExtractor';
import { fetchUrlForIngest } from '../ingestion/ingestionService';
import { buildSupplementalFileQueuePayload } from './supplementalFileQueuePayload';
import { cleanupStagedFile } from '../ingestion/uploadStaging';
import { logger } from '../../utils/logger';

/**
 * Revision-request supplemental ingest. Mirrors `ingestSupplementalForRun`
 * but tags the resulting ingestion-job and source metadata with the
 * `revision_request_id` and `report_id` so the revision pipeline (and any
 * future runs) can find this material later.
 *
 * Two roles:
 *   1. Persistence: queue files/URLs onto the same ingestion pipeline used
 *      by manual corpus uploads, so the user's "imported into the corpus"
 *      requirement holds — the chunks become permanent retrievable sources.
 *   2. Inline review: extract file text right here (PDF via pdfExtractor,
 *      txt/md as utf8) and sync-fetch URL text via `fetchUrlForIngest` so
 *      the caller can splice it into the immediate revision-intake /
 *      change_planner / section_rewriter prompts.
 */

export interface RevisionSupplementalFileItem {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export type RevisionUrlFetchStatus = 'ok' | 'failed';

export interface RevisionSupplementalIngestResult {
  jobIds: string[];
  urlsQueued: number;
  filesQueued: number;
  /** Concatenated text extracted from attached files and sync-fetched URLs. */
  inlineContext: string;
  /** Per-attachment summaries for audit / UI display. */
  attachments: Array<
    | {
        kind: 'url';
        url: string;
        ingestion_job_id: string;
        fetch_status: RevisionUrlFetchStatus;
        extractedChars: number;
        error?: string;
      }
    | {
        kind: 'file';
        filename: string;
        mimetype: string;
        ingestion_job_id: string;
        extractedChars: number;
        fetch_status: 'ok' | 'failed';
        error?: string;
      }
  >;
}

const REVISION_META = (reportId: string, revisionRequestId: string) => ({
  report_id: reportId,
  revision_request_id: revisionRequestId,
  attached_as: 'revision_supplement',
});

const MAX_INLINE_CONTEXT_CHARS = 60_000;
const MAX_PER_FILE_CHARS = 20_000;
const MAX_PER_URL_CHARS = 20_000;

/** Regression guard — placeholder-only URL inline text must not ship (Rule 35). */
export const REVISION_URL_PLACEHOLDER_MARKER = 'Content fetched into corpus asynchronously';

export async function ingestSupplementalForRevision(args: {
  reportId: string;
  revisionRequestId: string;
  urls: string[];
  files: RevisionSupplementalFileItem[];
  userId?: string;
}): Promise<RevisionSupplementalIngestResult> {
  const { reportId, revisionRequestId, urls, files, userId } = args;
  const jobIds: string[] = [];
  let urlsQueued = 0;
  let filesQueued = 0;
  const attachments: RevisionSupplementalIngestResult['attachments'] = [];
  const inlineParts: string[] = [];

  const meta = REVISION_META(reportId, revisionRequestId);

  for (const rawUrl of urls) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) continue;
    const id = uuidv4();
    const metaJson = JSON.stringify(meta);
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata, user_id)
         VALUES ($1, $2, 'web_url', 'queued', $3, $4)`,
        [id, url, metaJson, userId ?? null]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
         VALUES ($1, $2, 'web_url', 'queued', $3)`,
        [id, url, metaJson]
      );
    }
    await ingestionQueue.add('ingest-url', {
      ingestionJobId: id,
      url,
      sourceType: 'web_url',
      tags: [],
      metadata: meta,
      importedVia: 'manual_url',
    });
    jobIds.push(id);
    urlsQueued += 1;

    let fetchStatus: RevisionUrlFetchStatus = 'failed';
    let extractedChars = 0;
    let fetchError: string | undefined;
    let inlineText = '';
    try {
      const fetched = await fetchUrlForIngest(url);
      inlineText = fetched.content.slice(0, MAX_PER_URL_CHARS);
      extractedChars = inlineText.length;
      fetchStatus = inlineText.length > 0 ? 'ok' : 'failed';
      if (inlineText.length === 0) {
        fetchError = 'URL returned no extractable text';
      }
    } catch (err) {
      fetchError = err instanceof Error ? err.message : String(err);
      logger.warn(`[revision-supplement] URL fetch failed for ${url}:`, err);
    }

    attachments.push({
      kind: 'url',
      url,
      ingestion_job_id: id,
      fetch_status: fetchStatus,
      extractedChars,
      ...(fetchError ? { error: fetchError } : {}),
    });

    if (inlineText.length > 0) {
      inlineParts.push(`# Attached URL: ${url}\nTitle: ${inlineText.slice(0, 120).split('\n')[0]}\n${inlineText}`);
    } else {
      inlineParts.push(
        `# Attached URL (fetch failed)\n${url}\nError: ${fetchError ?? 'no content extracted'}`
      );
    }
  }

  for (const file of files) {
    const parsed = buildSupplementalFileQueuePayload({
      originalname: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });
    if (!parsed) {
      continue;
    }

    const { sourceType, fileData } = parsed;
    const id = uuidv4();
    let extractedText = '';
    let fileFetchError: string | undefined;

    if (sourceType === 'pdf') {
      try {
        const result = await extractPdf(file.buffer);
        extractedText = result.text ?? '';
      } catch (err) {
        fileFetchError = err instanceof Error ? err.message : String(err);
        logger.warn(`[revision-supplement] PDF extraction failed for ${file.originalname}:`, err);
      }
    } else {
      extractedText = file.buffer.toString('utf8');
    }

    const fileMetaJson = JSON.stringify(meta);
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata, user_id)
         VALUES ($1, $2, $3, 'queued', $4, $5)`,
        [id, file.originalname, sourceType, fileMetaJson, userId ?? null]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
         VALUES ($1, $2, $3, 'queued', $4)`,
        [id, file.originalname, sourceType, fileMetaJson]
      );
    }

    try {
      await ingestionQueue.add('ingest-file', {
        ingestionJobId: id,
        ...fileData,
        fileName: file.originalname,
        sourceType,
        originalMimeType: file.mimetype,
        tags: [],
        metadata: meta,
        importedVia: 'manual_upload',
      });
    } catch (enqueueErr) {
      logger.warn('[revision-supplement] Failed to enqueue supplemental file ingest', {
        reportId,
        revisionRequestId,
        fileName: file.originalname,
        error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      });
      if (fileData.stagedFilePath) {
        cleanupStagedFile(fileData.stagedFilePath);
      }
      attachments.push({
        kind: 'file',
        filename: file.originalname,
        mimetype: file.mimetype,
        ingestion_job_id: id,
        extractedChars: 0,
        fetch_status: 'failed',
        error: 'Could not queue file for ingestion',
      });
      continue;
    }

    jobIds.push(id);
    filesQueued += 1;

    const trimmed = extractedText.slice(0, MAX_PER_FILE_CHARS);
    attachments.push({
      kind: 'file',
      filename: file.originalname,
      mimetype: file.mimetype,
      ingestion_job_id: id,
      extractedChars: trimmed.length,
      fetch_status: trimmed.length > 0 ? 'ok' : 'failed',
      ...(fileFetchError ? { error: fileFetchError } : {}),
    });
    if (trimmed.length > 0) {
      inlineParts.push(`# Attached file: ${file.originalname}\n${trimmed}`);
    }
  }

  if (jobIds.length > 0) {
    await waitForIngestionJobs(jobIds, config.discovery.ingestionWaitTimeoutMs);
  }

  let inlineContext = inlineParts.join('\n\n---\n\n');
  if (inlineContext.length > MAX_INLINE_CONTEXT_CHARS) {
    inlineContext = inlineContext.slice(0, MAX_INLINE_CONTEXT_CHARS) + '\n\n[...attachment context truncated for prompt budget]';
  }

  return { jobIds, urlsQueued, filesQueued, inlineContext, attachments };
}
