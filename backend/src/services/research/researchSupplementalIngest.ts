import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';
import { waitForIngestionJobs } from '../discovery/discoveryOrchestrator';

export interface SupplementalUrlItem {
  url: string;
}

export interface SupplementalFileItem {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export interface SupplementalIngestSummary {
  jobIds: string[];
  urlsQueued: number;
  filesQueued: number;
}

const RESEARCH_META = (runId: string) => ({
  research_run_id: runId,
  attached_as: 'research_supplement',
});

export async function ingestSupplementalForRun(args: {
  runId: string;
  urls: string[];
  files: SupplementalFileItem[];
}): Promise<SupplementalIngestSummary> {
  const { runId, urls, files } = args;
  const jobIds: string[] = [];
  let urlsQueued = 0;
  let filesQueued = 0;

  for (const rawUrl of urls) {
    const url = typeof rawUrl === 'string' ? rawUrl.trim() : '';
    if (!url) continue;
    const id = uuidv4();
    await query(
      `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
       VALUES ($1, $2, 'web_url', 'queued', $3)`,
      [id, url, JSON.stringify(RESEARCH_META(runId))]
    );
    await ingestionQueue.add('ingest-url', {
      ingestionJobId: id,
      url,
      sourceType: 'web_url',
      tags: [],
      metadata: RESEARCH_META(runId),
      importedVia: 'manual_url',
      discoveredByRunId: runId,
    });
    jobIds.push(id);
    urlsQueued += 1;
  }

  for (const file of files) {
    const id = uuidv4();
    const filename = file.originalname.toLowerCase();
    const mime = file.mimetype;

    let sourceType: 'text' | 'pdf' | 'markdown';
    let fileData: { text?: string; fileBuffer?: string };

    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      sourceType = 'pdf';
      fileData = { fileBuffer: file.buffer.toString('base64') };
    } else if (
      mime === 'text/markdown' ||
      mime === 'text/x-markdown' ||
      filename.endsWith('.md')
    ) {
      sourceType = 'markdown';
      fileData = { text: file.buffer.toString('utf8') };
    } else if (mime === 'text/plain' || filename.endsWith('.txt')) {
      sourceType = 'text';
      fileData = { text: file.buffer.toString('utf8') };
    } else {
      continue;
    }

    await query(
      `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
       VALUES ($1, $2, $3, 'queued', $4)`,
      [id, file.originalname, sourceType, JSON.stringify(RESEARCH_META(runId))]
    );

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
    jobIds.push(id);
    filesQueued += 1;
  }

  if (jobIds.length > 0) {
    await waitForIngestionJobs(jobIds, config.discovery.ingestionWaitTimeoutMs);
  }

  return { jobIds, urlsQueued, filesQueued };
}
