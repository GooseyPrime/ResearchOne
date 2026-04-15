import axios from 'axios';
import crypto from 'crypto';
import { query, queryOne, withTransaction } from '../../db/pool';
import { embeddingQueue } from '../../queue/queues';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { chunkText } from './chunker';

export interface IngestionJobData {
  ingestionJobId: string;
  url?: string;
  text?: string;
  fileName?: string;
  sourceType: 'web_url' | 'pdf' | 'text' | 'arxiv' | 'doi' | 'youtube_transcript' | 'api_import';
  tags?: string[];
  metadata?: Record<string, unknown>;
}

export interface IngestionProgress {
  stage: string;
  percent: number;
  message: string;
}

type ProgressCallback = (progress: IngestionProgress) => void;

export async function runIngestionJob(
  data: IngestionJobData,
  onProgress: ProgressCallback
): Promise<{ sourceId: string; chunkCount: number }> {
  const { ingestionJobId, sourceType, tags = [], metadata = {} } = data;

  // Mark job as running
  await query(
    `UPDATE ingestion_jobs SET status='running', started_at=NOW() WHERE id=$1`,
    [ingestionJobId]
  );

  try {
    onProgress({ stage: 'fetch', percent: 10, message: 'Fetching source content...' });

    let rawContent = '';
    let title = '';
    let url = data.url ?? '';

    if (sourceType === 'web_url' && data.url) {
      const fetched = await fetchUrl(data.url);
      rawContent = fetched.content;
      title = fetched.title;
    } else if (data.text) {
      rawContent = data.text;
      title = data.fileName ?? 'Imported Text';
    } else {
      throw new Error('No content source provided');
    }

    if (!rawContent || rawContent.trim().length === 0) {
      throw new Error('Fetched content is empty');
    }

    onProgress({ stage: 'dedup', percent: 20, message: 'Checking for duplicates...' });

    const contentHash = crypto
      .createHash('sha256')
      .update(rawContent)
      .digest('hex');

    const existing = await queryOne<{ id: string }>(
      'SELECT id FROM sources WHERE content_hash=$1',
      [contentHash]
    );

    if (existing) {
      await query(
        `UPDATE ingestion_jobs SET status='completed', completed_at=NOW() WHERE id=$1`,
        [ingestionJobId]
      );
      return { sourceId: existing.id, chunkCount: 0 };
    }

    onProgress({ stage: 'store', percent: 30, message: 'Storing source...' });

    let sourceId!: string;
    let documentId!: string;
    let chunks: string[] = [];

    await withTransaction(async (client) => {
      // Insert source
      const sourceResult = await client.query(
        `INSERT INTO sources (url, title, source_type, raw_content, content_hash, tags, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [url, title, sourceType, rawContent, contentHash, tags, JSON.stringify(metadata)]
      );
      sourceId = sourceResult.rows[0].id;

      // Update ingestion job with source
      await client.query(
        `UPDATE ingestion_jobs SET source_id=$1 WHERE id=$2`,
        [sourceId, ingestionJobId]
      );

      // Insert document
      const docResult = await client.query(
        `INSERT INTO documents (source_id, title, content) VALUES ($1, $2, $3) RETURNING id`,
        [sourceId, title, rawContent]
      );
      documentId = docResult.rows[0].id;
    });

    onProgress({ stage: 'chunk', percent: 50, message: 'Chunking document...' });

    chunks = chunkText(rawContent, {
      maxChunkSize: config.ingestion.maxChunkSize,
      overlap: config.ingestion.chunkOverlap,
    });

    logger.info(`Created ${chunks.length} chunks for source ${sourceId}`);

    onProgress({ stage: 'store_chunks', percent: 60, message: `Storing ${chunks.length} chunks...` });

    // Batch insert chunks
    const chunkIds: string[] = [];
    await withTransaction(async (client) => {
      for (let i = 0; i < chunks.length; i++) {
        const res = await client.query(
          `INSERT INTO chunks (document_id, source_id, chunk_index, content, token_count, start_char, end_char)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [documentId, sourceId, i, chunks[i], estimateTokens(chunks[i]), 0, chunks[i].length]
        );
        chunkIds.push(res.rows[0].id);
      }
    });

    onProgress({ stage: 'queue_embedding', percent: 80, message: 'Queuing embedding generation...' });

    // Queue embedding job for these chunks
    await embeddingQueue.add('embed-chunks', {
      sourceId,
      chunkIds,
    });

    // Mark job complete
    await query(
      `UPDATE ingestion_jobs SET status='completed', completed_at=NOW() WHERE id=$1`,
      [ingestionJobId]
    );

    onProgress({ stage: 'done', percent: 100, message: 'Ingestion complete' });

    return { sourceId, chunkCount: chunks.length };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    await query(
      `UPDATE ingestion_jobs SET status='failed', error_message=$1, completed_at=NOW() WHERE id=$2`,
      [errMsg, ingestionJobId]
    );
    logger.error(`Ingestion job ${ingestionJobId} failed:`, err);
    throw err;
  }
}

async function fetchUrl(url: string): Promise<{ content: string; title: string }> {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'ResearchOne/1.0 (+https://researchone.app)' },
    maxContentLength: 50 * 1024 * 1024,
  });

  const html: string = response.data;

  // Remove entire script/style blocks including their content first.
  // Use a permissive end-tag pattern that handles attributes or spaces before '>'
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');

  // Strip remaining HTML tags (any tag that starts with < and ends with >)
  const content = withoutStyles
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;

  return { content, title };
}

function estimateTokens(text: string): number {
  // Rough approximation: 4 chars per token
  return Math.ceil(text.length / 4);
}
