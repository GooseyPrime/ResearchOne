import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';
import {
  fetchIngestionJobOutcomes,
  waitForIngestionJobs,
} from '../discovery/discoveryOrchestrator';
import type { ResolvedSupplementalUrlCrawl } from './supplementalUrlCrawl';
import { buildSupplementalFileQueuePayload } from './supplementalFileQueuePayload';
import { cleanupStagedFile } from '../ingestion/uploadStaging';
import { logger } from '../../utils/logger';

export interface SupplementalUrlItem {
  url: string;
}

export interface SupplementalFileItem {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export type SupplementalFileOutcome =
  | { filename: string; status: 'queued'; ingestionJobId: string }
  | { filename: string; status: 'skipped'; reason: string }
  | { filename: string; status: 'failed'; reason: string };

export interface SupplementalIngestSummary {
  jobIds: string[];
  urlsQueued: number;
  filesQueued: number;
  filesAttempted: number;
  fileOutcomes: SupplementalFileOutcome[];
  ingestOutcomes: Awaited<ReturnType<typeof fetchIngestionJobOutcomes>>;
}

const RESEARCH_META = (runId: string) => ({
  research_run_id: runId,
  attached_as: 'research_supplement',
});

export async function ingestSupplementalForRun(args: {
  runId: string;
  urls: string[];
  files: SupplementalFileItem[];
  userId?: string;
  urlCrawl?: ResolvedSupplementalUrlCrawl;
}): Promise<SupplementalIngestSummary> {
  const { runId, urls, files, userId, urlCrawl } = args;
  const crawlEnabled = urlCrawl?.siteCrawl === true;
  const crawlLayers = crawlEnabled ? urlCrawl?.crawlLayers : undefined;
  const jobIds: string[] = [];
  let urlsQueued = 0;
  let filesQueued = 0;
  const fileOutcomes: SupplementalFileOutcome[] = [];

  for (const rawUrl of urls) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) continue;
    const id = uuidv4();
    const researchMeta = {
      ...RESEARCH_META(runId),
      ...(crawlEnabled ? { site_crawl: true, crawl_layers: crawlLayers } : {}),
    };
    const meta = JSON.stringify(researchMeta);
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata, user_id)
         VALUES ($1, $2, 'web_url', 'queued', $3, $4)`,
        [id, url, meta, userId ?? null]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
         VALUES ($1, $2, 'web_url', 'queued', $3)`,
        [id, url, meta]
      );
    }
    await ingestionQueue.add('ingest-url', {
      ingestionJobId: id,
      url,
      sourceType: 'web_url',
      tags: [],
      metadata: researchMeta,
      importedVia: 'manual_url',
      discoveredByRunId: runId,
      ...(crawlEnabled ? { siteCrawl: true, crawlLayers } : {}),
    });
    jobIds.push(id);
    urlsQueued += 1;
  }

  for (const file of files) {
    const parsed = buildSupplementalFileQueuePayload({
      originalname: file.originalname,
      mimetype: file.mimetype,
      buffer: file.buffer,
    });

    if (!parsed) {
      fileOutcomes.push({
        filename: file.originalname,
        status: 'skipped',
        reason: 'Unsupported file type (PDF, TXT, or Markdown only)',
      });
      continue;
    }

    const { sourceType, fileData } = parsed;
    const id = uuidv4();
    const fileMeta = JSON.stringify(RESEARCH_META(runId));

    try {
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata, user_id)
         VALUES ($1, $2, $3, 'queued', $4, $5)`,
        [id, file.originalname, sourceType, fileMeta, userId ?? null]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
         VALUES ($1, $2, $3, 'queued', $4)`,
        [id, file.originalname, sourceType, fileMeta]
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
        metadata: RESEARCH_META(runId),
        importedVia: 'manual_upload',
        discoveredByRunId: runId,
      });
    } catch (enqueueErr) {
      const enqueueFailMsg = 'Could not queue file for ingestion';
      logger.warn('[research-supplement] Failed to enqueue supplemental file ingest', {
        runId,
        fileName: file.originalname,
        error: enqueueErr instanceof Error ? enqueueErr.message : String(enqueueErr),
      });
      try {
        await query(
          `UPDATE ingestion_jobs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
          [enqueueFailMsg, id],
        );
      } catch (markFailedErr) {
        logger.warn('[research-supplement] Failed to mark ingestion job failed after enqueue error', {
          ingestionJobId: id,
          error: markFailedErr instanceof Error ? markFailedErr.message : String(markFailedErr),
        });
      }
      if (fileData.stagedFilePath) {
        cleanupStagedFile(fileData.stagedFilePath);
      }
      fileOutcomes.push({
        filename: file.originalname,
        status: 'failed',
        reason: 'Could not queue file for ingestion',
      });
      continue;
    }

    jobIds.push(id);
    filesQueued += 1;
    fileOutcomes.push({ filename: file.originalname, status: 'queued', ingestionJobId: id });
  }

  if (jobIds.length > 0) {
    await waitForIngestionJobs(jobIds, config.discovery.ingestionWaitTimeoutMs);
  }

  const ingestOutcomes = await fetchIngestionJobOutcomes(jobIds);

  return {
    jobIds,
    urlsQueued,
    filesQueued,
    filesAttempted: files.length,
    fileOutcomes,
    ingestOutcomes,
  };
}
