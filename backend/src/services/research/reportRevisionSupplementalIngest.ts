import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';
import { waitForIngestionJobs } from '../discovery/discoveryOrchestrator';
import { extractPdf } from '../ingestion/pdfExtractor';
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
 *      requirement holds — the chunks become permanent retrievable evidence.
 *   2. Inline review: extract file text right here (PDF via pdfExtractor,
 *      txt/md as utf8) and return it as a single concatenated string so the
 *      caller can splice it into the immediate revision-intake /
 *      change_planner / section_rewriter prompts. The models therefore
 *      review the attached material on this revision call, not just on
 *      hypothetical future retrievals.
 */

export interface RevisionSupplementalFileItem {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface RevisionSupplementalIngestResult {
  jobIds: string[];
  urlsQueued: number;
  filesQueued: number;
  /** Concatenated text extracted from the attached files, sized so callers
   *  can safely include it in a model prompt. URLs are listed by reference
   *  (the corpus pipeline fetches them asynchronously). */
  inlineContext: string;
  /** Per-attachment summaries for audit / UI display. */
  attachments: Array<
    | { kind: 'url'; url: string; ingestion_job_id: string }
    | { kind: 'file'; filename: string; mimetype: string; ingestion_job_id: string; extractedChars: number }
  >;
}

const REVISION_META = (reportId: string, revisionRequestId: string) => ({
  report_id: reportId,
  revision_request_id: revisionRequestId,
  attached_as: 'revision_supplement',
});

const MAX_INLINE_CONTEXT_CHARS = 60_000;
const MAX_PER_FILE_CHARS = 20_000;

export async function ingestSupplementalForRevision(args: {
  reportId: string;
  revisionRequestId: string;
  urls: string[];
  files: RevisionSupplementalFileItem[];
}): Promise<RevisionSupplementalIngestResult> {
  const { reportId, revisionRequestId, urls, files } = args;
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
    await query(
      `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
       VALUES ($1, $2, 'web_url', 'queued', $3)`,
      [id, url, JSON.stringify(meta)]
    );
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
    attachments.push({ kind: 'url', url, ingestion_job_id: id });
    inlineParts.push(`# Attached URL\n${url}\n(Content fetched into corpus asynchronously; cite it after retrieval.)`);
  }

  for (const file of files) {
    const id = uuidv4();
    const filename = file.originalname.toLowerCase();
    const mime = file.mimetype;

    let sourceType: 'text' | 'pdf' | 'markdown';
    let fileData: { text?: string; fileBuffer?: string };
    let extractedText = '';

    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      sourceType = 'pdf';
      fileData = { fileBuffer: file.buffer.toString('base64') };
      try {
        const result = await extractPdf(file.buffer);
        extractedText = result.text ?? '';
      } catch (err) {
        logger.warn(`[revision-supplement] PDF extraction failed for ${file.originalname}:`, err);
      }
    } else if (
      mime === 'text/markdown' ||
      mime === 'text/x-markdown' ||
      filename.endsWith('.md') ||
      filename.endsWith('.markdown')
    ) {
      sourceType = 'markdown';
      const text = file.buffer.toString('utf8');
      fileData = { text };
      extractedText = text;
    } else if (mime === 'text/plain' || filename.endsWith('.txt')) {
      sourceType = 'text';
      const text = file.buffer.toString('utf8');
      fileData = { text };
      extractedText = text;
    } else {
      continue;
    }

    await query(
      `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
       VALUES ($1, $2, $3, 'queued', $4)`,
      [id, file.originalname, sourceType, JSON.stringify(meta)]
    );

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
    jobIds.push(id);
    filesQueued += 1;

    const trimmed = extractedText.slice(0, MAX_PER_FILE_CHARS);
    attachments.push({
      kind: 'file',
      filename: file.originalname,
      mimetype: file.mimetype,
      ingestion_job_id: id,
      extractedChars: trimmed.length,
    });
    if (trimmed.length > 0) {
      inlineParts.push(`# Attached file: ${file.originalname}\n${trimmed}`);
    }
  }

  // Wait briefly for ingestion to settle so the corpus has the chunks before
  // the revision pipeline returns. This is bounded by the same timeout the
  // research-run supplemental ingest uses.
  if (jobIds.length > 0) {
    await waitForIngestionJobs(jobIds, config.discovery.ingestionWaitTimeoutMs);
  }

  // Concatenate inline context, hard-capping total length so we never blow
  // through a model's prompt budget.
  let inlineContext = inlineParts.join('\n\n---\n\n');
  if (inlineContext.length > MAX_INLINE_CONTEXT_CHARS) {
    inlineContext = inlineContext.slice(0, MAX_INLINE_CONTEXT_CHARS) + '\n\n[...attachment context truncated for prompt budget]';
  }

  return { jobIds, urlsQueued, filesQueued, inlineContext, attachments };
}
