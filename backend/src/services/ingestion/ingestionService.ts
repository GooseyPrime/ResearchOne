import axios from 'axios';
import crypto from 'crypto';
import { query, queryOne, withTransaction } from '../../db/pool';
import { embeddingQueue } from '../../queue/queues';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { chunkText } from './chunker';
import { extractPdf } from './pdfExtractor';
import { normalizeMarkdown } from './markdownNormalizer';

export interface IngestionJobData {
  ingestionJobId: string;
  url?: string;
  text?: string;
  fileBuffer?: string; // base64 encoded for binary files
  fileName?: string;
  sourceType: 'web_url' | 'pdf' | 'text' | 'markdown' | 'arxiv' | 'doi' | 'youtube_transcript' | 'api_import';
  originalMimeType?: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  // Autonomous discovery provenance
  discoveredByRunId?: string;
  discoveryQuery?: string;
  sourceRank?: number;
  importedVia?: 'manual_upload' | 'manual_url' | 'autonomous_discovery' | 'corpus_sync';
  fetchMethod?: string;
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
    let fetchMetadata: Record<string, unknown> = {};
    let parseMethod = 'raw';

    if (sourceType === 'web_url' && data.url) {
      const fetched = await fetchUrl(data.url);
      rawContent = fetched.content;
      title = fetched.title;
      fetchMetadata = {
        canonical_url: fetched.canonicalUrl,
        meta_description: fetched.metaDescription,
        retrieval_timestamp: fetched.retrievalTimestamp,
        fetch_method: 'http_get',
      };
      parseMethod = 'html_extract';
    } else if (sourceType === 'pdf') {
      if (data.fileBuffer) {
        const buffer = Buffer.from(data.fileBuffer, 'base64');
        const extracted = await extractPdf(buffer);
        rawContent = extracted.text;
        title = extracted.metadata.title || data.fileName || 'Imported PDF';
        fetchMetadata = { ...extracted.metadata, fetch_method: 'pdf_parse' };
        parseMethod = 'pdf_parse';
      } else {
        throw new Error('PDF ingestion requires fileBuffer');
      }
    } else if (sourceType === 'markdown') {
      const mdText = data.text || (data.fileBuffer ? Buffer.from(data.fileBuffer, 'base64').toString('utf8') : '');
      if (!mdText) throw new Error('Markdown ingestion requires text or fileBuffer');
      const normalized = normalizeMarkdown(mdText);
      rawContent = normalized.text;
      title = data.fileName?.replace(/\.md$/i, '') || 'Imported Markdown';
      fetchMetadata = { ...normalized.metadata, fetch_method: 'markdown_parse', parse_method: 'markdown_normalize' };
      parseMethod = 'markdown_normalize';
    } else if (sourceType === 'text' && data.text) {
      rawContent = data.text;
      title = data.fileName ?? 'Imported Text';
      parseMethod = 'raw';
    } else if (sourceType === 'text' && data.fileBuffer) {
      rawContent = Buffer.from(data.fileBuffer, 'base64').toString('utf8');
      title = data.fileName ?? 'Imported Text';
      parseMethod = 'raw';
    } else if (data.text) {
      rawContent = data.text;
      title = data.fileName ?? 'Imported Text';
    } else {
      throw new Error(`Unsupported source type or missing content: ${sourceType}`);
    }

    if (!rawContent || rawContent.trim().length === 0) {
      throw new Error('Content is empty after extraction');
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
      // Insert source with provenance metadata
      const sourceResult = await client.query(
        `INSERT INTO sources (
           url, title, source_type, raw_content, content_hash, tags, metadata,
           discovered_by_run_id, discovery_query, source_rank, imported_via,
           original_mime_type, original_filename, fetch_method, canonical_url,
           retrieval_timestamp
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
         RETURNING id`,
        [
          url,
          title,
          sourceType,
          rawContent,
          contentHash,
          tags,
          JSON.stringify({ ...metadata, ...fetchMetadata }),
          data.discoveredByRunId ?? null,
          data.discoveryQuery ?? null,
          data.sourceRank ?? null,
          data.importedVia ?? 'manual_upload',
          data.originalMimeType ?? null,
          data.fileName ?? null,
          (fetchMetadata.fetch_method as string) ?? data.fetchMethod ?? null,
          (fetchMetadata.canonical_url as string) ?? null,
          fetchMetadata.retrieval_timestamp
            ? new Date(fetchMetadata.retrieval_timestamp as string)
            : new Date(),
        ]
      );
      sourceId = sourceResult.rows[0].id;

      // Update ingestion job with source
      await client.query(
        `UPDATE ingestion_jobs SET source_id=$1 WHERE id=$2`,
        [sourceId, ingestionJobId]
      );

      // Insert document with parse_method and extraction_metadata
      const docResult = await client.query(
        `INSERT INTO documents (source_id, title, content, parse_method, extraction_metadata)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [sourceId, title, rawContent, parseMethod, JSON.stringify(fetchMetadata)]
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

interface FetchResult {
  content: string;
  title: string;
  canonicalUrl: string | null;
  metaDescription: string | null;
  retrievalTimestamp: string;
}

async function fetchUrl(url: string): Promise<FetchResult> {
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'ResearchOne/1.0 (+https://researchone.app)' },
    maxContentLength: 50 * 1024 * 1024,
  });

  const html: string = response.data;
  const retrievalTimestamp = new Date().toISOString();

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : url;

  // Extract canonical URL
  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

  // Extract meta description
  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaDescription = descMatch ? descMatch[1].trim() : null;

  // Remove script and style blocks entirely
  const withoutScripts = html.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');

  // Remove nav, header, footer, aside boilerplate sections
  const withoutBoilerplate = withoutStyles
    .replace(/<nav[\s\S]*?<\/nav\s*>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header\s*>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer\s*>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside\s*>/gi, ' ');

  // Strip remaining HTML tags and clean whitespace.
  // Decode HTML entities in a single regex pass to avoid double-unescaping
  // (e.g. &amp;lt; should become &lt;, not <).
  const content = withoutBoilerplate
    .replace(/<[^>]*>/g, ' ')
    .replace(/&(nbsp|amp|lt|gt|quot|#39|#x27|apos);/gi, (_match, entity: string) => {
      const entityMap: Record<string, string> = {
        nbsp: ' ',
        amp: '&',
        lt: '<',
        gt: '>',
        quot: '"',
        '#39': "'",
        '#x27': "'",
        apos: "'",
      };
      return entityMap[entity.toLowerCase()] ?? _match;
    })
    .replace(/\s+/g, ' ')
    .trim();

  return { content, title, canonicalUrl, metaDescription, retrievalTimestamp };
}

function estimateTokens(text: string): number {
  // Rough approximation: 4 chars per token
  return Math.ceil(text.length / 4);
}
