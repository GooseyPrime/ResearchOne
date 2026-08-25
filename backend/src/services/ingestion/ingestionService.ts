import axios from 'axios';
import crypto from 'crypto';
import { query, queryOne, withTransaction } from '../../db/pool';
import { embeddingQueue } from '../../queue/queues';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { chunkText } from './chunker';
import { extractPdf } from './pdfExtractor';
import { normalizeMarkdown } from './markdownNormalizer';
import { readStagedFile, cleanupStagedFile } from './uploadStaging';
import { discoverSiteCrawlUrls } from './siteCrawl';
import { assertPublicHttpUrl } from './urlFetchPolicy';

export interface IngestionJobData {
  ingestionJobId: string;
  url?: string;
  text?: string;
  fileBuffer?: string; // base64 encoded — DEPRECATED, kept for deploy-skew backward compat
  stagedFilePath?: string;
  stagedFileSha256?: string;
  stagedFileSizeBytes?: number;
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
  /** When true, crawl same-origin links up to `crawlLayers` depth (manual URL ingest only). */
  siteCrawl?: boolean;
  /** Layer count: 1 = seed page only; 2 = seed + pages it links to; etc. */
  crawlLayers?: number;
}

export interface IngestionProgress {
  stage: string;
  percent: number;
  message: string;
}

type ProgressCallback = (progress: IngestionProgress) => void;

/** PostgreSQL text columns reject U+0000. Strip before any INSERT. */
function stripNul(s: string): string {
  return s.includes('\0') ? s.replace(/\0/g, '') : s;
}

async function resolveIngestionJobUserId(ingestionJobId: string): Promise<string | null> {
  try {
    const row = await queryOne<{ user_id: string | null }>(
      'SELECT user_id FROM ingestion_jobs WHERE id=$1',
      [ingestionJobId]
    );
    return row?.user_id ?? null;
  } catch (err) {
    if ((err as { code?: string })?.code === '42703') return null;
    throw err;
  }
}

export async function runIngestionJob(
  data: IngestionJobData,
  onProgress: ProgressCallback
): Promise<{ sourceId: string; chunkCount: number }> {
  const { ingestionJobId, sourceType, tags = [], metadata = {} } = data;
  const ingestedByUserId = await resolveIngestionJobUserId(ingestionJobId);

  // Mark job as running
  await query(
    `UPDATE ingestion_jobs SET status='running', started_at=NOW() WHERE id=$1`,
    [ingestionJobId]
  );

  try {
    onProgress({ stage: 'fetch', percent: 10, message: 'Fetching source content...' });

    let rawContent = '';
    let title = '';
    const url = data.url ?? '';
    let fetchMetadata: Record<string, unknown> = {};
    let parseMethod = 'raw';

    if (sourceType === 'web_url' && data.url) {
      if (data.siteCrawl && (data.crawlLayers ?? 1) > 1) {
        return await runSiteCrawlIngestion(data, onProgress);
      }
      const fetched = await fetchUrlForIngest(data.url);
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
      let buffer: Buffer | null = null;
      if (data.stagedFilePath) {
        buffer = readStagedFile(data.stagedFilePath);
      } else if (data.fileBuffer) {
        buffer = Buffer.from(data.fileBuffer, 'base64');
      }
      if (!buffer) throw new Error('PDF ingestion requires stagedFilePath or fileBuffer');
      const extracted = await extractPdf(buffer);
      rawContent = extracted.text;
      title = extracted.metadata.title || data.fileName || 'Imported PDF';
      fetchMetadata = { ...extracted.metadata, fetch_method: 'pdf_parse' };
      parseMethod = 'pdf_parse';
    } else if (sourceType === 'markdown') {
      let mdText = data.text || '';
      if (!mdText && data.stagedFilePath) {
        mdText = readStagedFile(data.stagedFilePath).toString('utf8');
      } else if (!mdText && data.fileBuffer) {
        mdText = Buffer.from(data.fileBuffer, 'base64').toString('utf8');
      }
      if (!mdText) throw new Error('Markdown ingestion requires text, stagedFilePath, or fileBuffer');
      const normalized = normalizeMarkdown(mdText);
      rawContent = normalized.text;
      title = data.fileName?.replace(/\.md$/i, '') || 'Imported Markdown';
      fetchMetadata = { ...normalized.metadata, fetch_method: 'markdown_parse', parse_method: 'markdown_normalize' };
      parseMethod = 'markdown_normalize';
    } else if (sourceType === 'text' && (data.text || data.stagedFilePath)) {
      rawContent = data.text || readStagedFile(data.stagedFilePath!).toString('utf8');
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

    rawContent = stripNul(rawContent);
    title = stripNul(title);

    if (!rawContent || rawContent.trim().length === 0) {
      throw new Error('Content is empty after extraction');
    }

    const { sourceId, chunkCount } = await ingestFetchedWebPage({
      data,
      pageUrl: url,
      title,
      rawContent,
      parseMethod,
      fetchMetadata,
      tags,
      metadata,
      linkJobSource: true,
      ingestedByUserId,
      onProgress,
    });

    await query(
      `UPDATE ingestion_jobs SET status='completed', completed_at=NOW() WHERE id=$1`,
      [ingestionJobId]
    );

    onProgress({ stage: 'done', percent: 100, message: 'Ingestion complete' });

    if (data.stagedFilePath) cleanupStagedFile(data.stagedFilePath);
    return { sourceId, chunkCount };
  } catch (err) {
    if (data.stagedFilePath) cleanupStagedFile(data.stagedFilePath);
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

interface IngestFetchedWebPageParams {
  data: IngestionJobData;
  pageUrl: string;
  title: string;
  rawContent: string;
  parseMethod: string;
  fetchMetadata: Record<string, unknown>;
  tags: string[];
  metadata: Record<string, unknown>;
  linkJobSource: boolean;
  /** Clerk user who queued the ingestion job (for crawl child ownership). */
  ingestedByUserId?: string | null;
  onProgress: ProgressCallback;
}

/** Persist one fetched web page: dedup, source row, chunks, embedding queue. */
async function ingestFetchedWebPage(params: IngestFetchedWebPageParams): Promise<{
  sourceId: string;
  chunkCount: number;
  duplicate: boolean;
}> {
  const {
    data,
    pageUrl,
    title,
    rawContent,
    parseMethod,
    fetchMetadata,
    tags,
    metadata,
    linkJobSource,
    ingestedByUserId,
    onProgress,
  } = params;

  const sourceType = data.sourceType;
  const storedMetadata: Record<string, unknown> = {
    ...metadata,
    ...fetchMetadata,
  };
  if (ingestedByUserId) {
    storedMetadata.ingested_by_user_id = ingestedByUserId;
  }

  onProgress({ stage: 'dedup', percent: 20, message: 'Checking for duplicates...' });

  const contentHash = crypto.createHash('sha256').update(rawContent).digest('hex');

  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM sources WHERE content_hash=$1',
    [contentHash]
  );

  if (existing) {
    if (linkJobSource && data.ingestionJobId) {
      await query(
        `UPDATE ingestion_jobs SET source_id=$1 WHERE id=$2`,
        [existing.id, data.ingestionJobId]
      );
    }
    return { sourceId: existing.id, chunkCount: 0, duplicate: true };
  }

  onProgress({ stage: 'store', percent: 30, message: 'Storing source...' });

  let sourceId!: string;
  let documentId!: string;

  await withTransaction(async (client) => {
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
        pageUrl || null,
        title,
        sourceType,
        rawContent,
        contentHash,
        tags,
        JSON.stringify(storedMetadata),
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

    if (linkJobSource && data.ingestionJobId) {
      await client.query(
        `UPDATE ingestion_jobs SET source_id=$1 WHERE id=$2`,
        [sourceId, data.ingestionJobId]
      );
    }

    const docResult = await client.query(
      `INSERT INTO documents (source_id, title, content, parse_method, extraction_metadata)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [sourceId, title, rawContent, parseMethod, JSON.stringify(fetchMetadata)]
    );
    documentId = docResult.rows[0].id;
  });

  onProgress({ stage: 'chunk', percent: 50, message: 'Chunking document...' });

  const chunks = chunkText(rawContent, {
    maxChunkSize: config.ingestion.maxChunkSize,
    overlap: config.ingestion.chunkOverlap,
  });

  logger.info(`Created ${chunks.length} chunks for source ${sourceId}`);

  onProgress({ stage: 'store_chunks', percent: 60, message: `Storing ${chunks.length} chunks...` });

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

  await embeddingQueue.add('embed-chunks', {
    sourceId,
    chunkIds,
  });

  return { sourceId, chunkCount: chunks.length, duplicate: false };
}

async function runSiteCrawlIngestion(
  data: IngestionJobData,
  onProgress: ProgressCallback
): Promise<{ sourceId: string; chunkCount: number }> {
  const seedUrl = data.url!;
  const crawlLayers = data.crawlLayers ?? 2;
  const tags = data.tags ?? [];
  const baseMetadata = data.metadata ?? {};
  const ingestedByUserId = await resolveIngestionJobUserId(data.ingestionJobId);

  onProgress({
    stage: 'crawl_discover',
    percent: 5,
    message: `Discovering pages (up to ${crawlLayers} layers)...`,
  });

  const pageUrls = await discoverSiteCrawlUrls({
    seedUrl,
    crawlLayers,
    maxPages: config.ingestion.siteCrawlMaxPages,
    fetchHtml: fetchUrlRawHtml,
  });

  if (pageUrls.length === 0) {
    throw new Error('Site crawl found no pages to ingest');
  }

  let seedSourceId: string | null = null;
  let totalChunks = 0;
  const sourceIds: string[] = [];
  let ingested = 0;
  let skippedDuplicate = 0;
  let failed = 0;

  for (let i = 0; i < pageUrls.length; i++) {
    const pageUrl = pageUrls[i];
    const pct = 10 + Math.floor((i / pageUrls.length) * 75);
    onProgress({
      stage: 'crawl_fetch',
      percent: pct,
      message: `Ingesting page ${i + 1} of ${pageUrls.length}...`,
    });

    try {
      const fetched = await fetchUrlForIngest(pageUrl);
      const rawContent = stripNul(fetched.content);
      const title = stripNul(fetched.title);
      if (!rawContent.trim()) {
        failed += 1;
        continue;
      }

      const fetchMetadata = {
        canonical_url: fetched.canonicalUrl,
        meta_description: fetched.metaDescription,
        retrieval_timestamp: fetched.retrievalTimestamp,
        fetch_method: 'http_get',
        site_crawl_seed: seedUrl,
        site_crawl_layers: crawlLayers,
      };

      const result = await ingestFetchedWebPage({
        data,
        pageUrl,
        title,
        rawContent,
        parseMethod: 'html_extract',
        fetchMetadata: {
          ...fetchMetadata,
          site_crawl_page_index: i,
        },
        tags,
        metadata: {
          ...baseMetadata,
          site_crawl: true,
          site_crawl_seed: seedUrl,
        },
        linkJobSource: i === 0,
        ingestedByUserId,
        onProgress: (p) => onProgress({ ...p, percent: Math.min(85, pct + 5) }),
      });

      sourceIds.push(result.sourceId);
      if (i === 0) seedSourceId = result.sourceId;
      totalChunks += result.chunkCount;
      if (result.duplicate) skippedDuplicate += 1;
      else ingested += 1;
    } catch (err) {
      failed += 1;
      logger.warn('site_crawl_page_failed', {
        pageUrl,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  if (!seedSourceId && sourceIds.length > 0) {
    seedSourceId = sourceIds[0];
  }

  if (!seedSourceId) {
    throw new Error(
      `Site crawl could not ingest any pages (${failed} failed, ${skippedDuplicate} duplicates)`
    );
  }

  await query(
    `UPDATE ingestion_jobs SET status='completed', completed_at=NOW(),
     metadata = COALESCE(metadata, '{}'::jsonb) || $2::jsonb
     WHERE id=$1`,
    [
      data.ingestionJobId,
      JSON.stringify({
        site_crawl: true,
        site_crawl_seed: seedUrl,
        crawl_layers: crawlLayers,
        pages_discovered: pageUrls.length,
        pages_ingested: ingested,
        pages_duplicate: skippedDuplicate,
        pages_failed: failed,
        source_ids: sourceIds,
      }),
    ]
  );

  onProgress({
    stage: 'done',
    percent: 100,
    message: `Site crawl complete (${ingested} new, ${skippedDuplicate} duplicate, ${failed} failed)`,
  });

  return { sourceId: seedSourceId, chunkCount: totalChunks };
}

/** Raw HTML fetch for same-origin link discovery during site crawl. */
export async function fetchUrlRawHtml(url: string): Promise<string> {
  assertPublicHttpUrl(url);
  const response = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'ResearchOne/1.0 (+https://researchone.io)' },
    maxContentLength: 50 * 1024 * 1024,
    responseType: 'text',
    transformResponse: [(body) => body],
    validateStatus: (status) => status >= 200 && status < 400,
  });
  return typeof response.data === 'string' ? response.data : String(response.data);
}

/**
 * A readable name for a source whose page gave us no title.
 *
 * Falling back to the URL produced sources whose title was
 * `https://arxiv.org/pdf/2204.08880v1` — a source with no title cannot be
 * assessed by a reader or weighed by a model, and several of those appeared in
 * the operator's report. This turns a path into words where the path has any,
 * and otherwise names the host, which is at least a claim about provenance.
 */
export function titleFromUrl(rawUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return rawUrl;
  }
  const host = parsed.hostname.replace(/^www\./, '');
  const segments = parsed.pathname.split('/').filter(Boolean);
  const bare = (segments[segments.length - 1] ?? '').replace(/\.(pdf|html?|php|aspx?|txt|md)$/i, '');
  // A segment that is only digits, dots and version markers ("2204.08880v1")
  // is an identifier, not a name — keep it intact and say what it identifies.
  if (!bare) return host;
  if (/^[\d.v]+$/i.test(bare)) return `${host} ${bare}`;
  const slug = bare.replace(/[._-]+/g, ' ').replace(/\s+/g, ' ').trim();
  return slug ? `${slug} (${host})` : host;
}

/** True when a stored title is really just the address of the thing. */
export function titleIsJustTheUrl(title: string | null | undefined, url: string): boolean {
  const t = (title ?? '').trim();
  if (!t) return true;
  if (t === url.trim()) return true;
  return /^https?:\/\/\S+$/i.test(t);
}

export function parseHtmlToContent(html: string, pageUrl: string): FetchResult {
  const retrievalTimestamp = new Date().toISOString();

  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const rawTitle = titleMatch ? titleMatch[1].trim() : '';
  // Never store the address as the name of the thing. A PDF served over HTTP
  // has no <title> at all, which is how `https://arxiv.org/pdf/2204.08880v1`
  // became the title of a source in a finished report.
  const title = titleIsJustTheUrl(rawTitle, pageUrl) ? titleFromUrl(pageUrl) : rawTitle;

  const canonicalMatch = html.match(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i)
    || html.match(/<link[^>]+href=["']([^"']+)["'][^>]+rel=["']canonical["']/i);
  const canonicalUrl = canonicalMatch ? canonicalMatch[1].trim() : null;

  const descMatch = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+name=["']description["']/i);
  const metaDescription = descMatch ? descMatch[1].trim() : null;

  const withoutScripts = html.replace(/<script[\s\S]*?<\/script\s*>/gi, ' ');
  const withoutStyles = withoutScripts.replace(/<style[\s\S]*?<\/style\s*>/gi, ' ');

  const withoutBoilerplate = withoutStyles
    .replace(/<nav[\s\S]*?<\/nav\s*>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header\s*>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer\s*>/gi, ' ')
    .replace(/<aside[\s\S]*?<\/aside\s*>/gi, ' ');

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

/** True when a URL or its content type says the body is a PDF, not a page. */
export function looksLikePdf(url: string, contentType?: string | null): boolean {
  if ((contentType ?? '').toLowerCase().includes('application/pdf')) return true;
  try {
    return /\.pdf$/i.test(new URL(url).pathname) || /\/pdf\//i.test(new URL(url).pathname);
  } catch {
    return /\.pdf($|\?)/i.test(url);
  }
}

/**
 * Shared URL fetch used by ingestion workers and revision supplemental
 * sync-fetch.
 *
 * A PDF used to go through the HTML path: fetched as text, stripped of
 * `<tags>` that were never there, and stored as whatever survived. An arXiv
 * paper ingested that way contributes a source row and no readable content,
 * which is how a report can report nine sources and cite almost none of them.
 * PDFs are extracted as PDFs, with their embedded title when they carry one.
 */
export async function fetchUrlForIngest(url: string): Promise<FetchResult> {
  assertPublicHttpUrl(url);
  const retrievalTimestamp = new Date().toISOString();

  const head = await axios.get(url, {
    timeout: 30000,
    headers: { 'User-Agent': 'ResearchOne/1.0 (+https://researchone.io)' },
    maxContentLength: 50 * 1024 * 1024,
    responseType: 'arraybuffer',
    validateStatus: (status) => status >= 200 && status < 400,
  });
  const contentType = String(head.headers?.['content-type'] ?? '');
  const buffer = Buffer.from(head.data as ArrayBuffer);

  if (looksLikePdf(url, contentType)) {
    const extracted = await extractPdf(buffer);
    const embeddedTitle = (extracted.metadata.title ?? '').trim();
    return {
      content: extracted.text,
      title: titleIsJustTheUrl(embeddedTitle, url) ? titleFromUrl(url) : embeddedTitle,
      canonicalUrl: null,
      metaDescription: null,
      retrievalTimestamp,
    };
  }

  return parseHtmlToContent(buffer.toString('utf8'), url);
}

function estimateTokens(text: string): number {
  // Rough approximation: 4 chars per token
  return Math.ceil(text.length / 4);
}
