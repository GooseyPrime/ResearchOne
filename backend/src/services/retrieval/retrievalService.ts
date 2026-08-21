/**
 * AUDIT (epistemic): No LLM query expansion — user query is embedded and used for FTS as-is.
 * If query rewriting is added, wrap LLM system prompts with withPreamble from constants/prompts.ts.
 */

import { config } from '../../config';
import { query } from '../../db/pool';
import { generateEmbeddings } from '../openrouter/openrouterService';
import { logger } from '../../utils/logger';
import {
  evaluateCorpusGate,
  intentNeedsIndependentExternalEvidence,
  resolveCorpusPartition,
  UNCLASSIFIED_PARTITION,
  type CorpusGateDecision,
  type CorpusSourceRecord,
} from './corpusCompetenceGate';
import type { IntentId } from '../planning/intentTaxonomy';

export interface RetrievedChunk {
  id: string;
  content: string;
  source_url: string;
  source_title: string;
  chunk_index: number;
  similarity: number;
  evidence_tier: string | null;
  tags: string[];
  owner_user_id?: string | null;
  source_origin?: 'external_discovery' | 'user_upload' | 'researchone_generated' | 'user_supplied_url' | null;
}

export interface RetrievalOptions {
  query: string;
  topK?: number;
  minSimilarity?: number;
  filterTags?: string[];
  hybridSearch?: boolean;  // combine vector + full-text
  /** When set, restrict hits to these corpus source ids (revision supplemental scope). */
  sourceIds?: string[];
  intentId?: IntentId;
  userId?: string;
  /** Current research run id — sources discovered for this run are always citable. */
  runId?: string;
}

export interface RetrievalAuditResult {
  citableChunks: RetrievedChunk[];
  backgroundChunks: RetrievedChunk[];
  corpusGate: CorpusGateDecision;
}

function deriveSourceOrigin(
  metadataSourceOrigin: string | null,
  importedVia: string | null
): 'external_discovery' | 'user_upload' | 'researchone_generated' | 'user_supplied_url' | null {
  const normalizedMetadata = (metadataSourceOrigin ?? '').trim().toLowerCase();
  if (
    normalizedMetadata === 'external_discovery'
    || normalizedMetadata === 'user_upload'
    || normalizedMetadata === 'researchone_generated'
    || normalizedMetadata === 'user_supplied_url'
  ) {
    return normalizedMetadata as 'external_discovery' | 'user_upload' | 'researchone_generated' | 'user_supplied_url';
  }
  const normalizedImportedVia = (importedVia ?? '').trim().toLowerCase();
  if (normalizedImportedVia === 'manual_upload') return 'user_upload';
  if (normalizedImportedVia === 'manual_url') return 'user_supplied_url';
  if (normalizedImportedVia === 'corpus_sync') return 'researchone_generated';
  return null;
}

/**
 * Hybrid retrieval: combines semantic (vector) search with BM25-style full-text search.
 * Semantic results weighted by cosine similarity; FTS results boosted by relevance rank.
 */
export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  return (await retrieveChunksWithAudit(options)).citableChunks;
}

export async function retrieveChunksWithAudit(options: RetrievalOptions): Promise<RetrievalAuditResult> {
  const {
    query: queryText,
    topK = 20,
    minSimilarity = config.retrieval.minSimilarityDefault,
    filterTags,
    hybridSearch = true,
    sourceIds,
    intentId,
    runId,
  } = options;

  const results: Map<string, RetrievedChunk> = new Map();
  const backgroundResults: Map<string, RetrievedChunk> = new Map();

  const sourceStats = await loadCorpusSourceStats({ filterTags, sourceIds });
  const thresholds = config.retrieval.corpusGate;
  const partition = resolveCorpusPartition({
    intentId,
    filterTags,
    sourceRecords: sourceStats.records,
  });

  const corpusGate = evaluateCorpusGate({
    partition,
    sourceRecords: sourceStats.records.filter((record) => {
      const recordPartition = record.partitionKey?.trim().toLowerCase()
        || resolveCorpusPartition({ intentId, sourceRecords: [record] });
      return recordPartition === partition;
    }),
    thresholds,
    minSimilarity,
    globalTotalChunks: sourceStats.globalTotalChunks,
  });

  if (sourceStats.failClosedReason) {
    corpusGate.status = 'sealed';
    corpusGate.reason = sourceStats.failClosedReason;
    return {
      citableChunks: [],
      backgroundChunks: [],
      corpusGate,
    };
  }

  if (corpusGate.status === 'sealed') {
    return {
      citableChunks: [],
      backgroundChunks: [],
      corpusGate,
    };
  }

  // ─── Semantic vector search ─────────────────────────────────────────────
  try {
    const vectors = await generateEmbeddings([queryText]);
    const queryVector = vectors[0];

    if (queryVector && queryVector.length > 0) {
      const vectorStr = `[${queryVector.join(',')}]`;

      let vectorSql = `
        SELECT
          c.id,
          c.content,
          c.chunk_index,
          s.url AS source_url,
          s.title AS source_title,
          s.tags,
          s.imported_via,
          COALESCE(ij.user_id, NULLIF(s.metadata->>'ingested_by_user_id', '')) AS owner_user_id,
          NULLIF(s.metadata->>'source_origin', '') AS metadata_source_origin,
          s.discovered_by_run_id,
          1 - (e.vector <=> $1::vector) AS similarity,
          cl.evidence_tier
        FROM embeddings e
        JOIN chunks c ON c.id = e.chunk_id
        LEFT JOIN sources s ON s.id = c.source_id
        LEFT JOIN LATERAL (
          SELECT jobs.user_id
          FROM ingestion_jobs jobs
          WHERE jobs.source_id = s.id
            AND jobs.user_id IS NOT NULL
          ORDER BY jobs.created_at DESC NULLS LAST
          LIMIT 1
        ) ij ON TRUE
        LEFT JOIN claims cl ON cl.chunk_id = c.id
        WHERE e.vector IS NOT NULL
          AND 1 - (e.vector <=> $1::vector) >= $2
      `;
      const params: unknown[] = [vectorStr, minSimilarity];

      if (partition !== UNCLASSIFIED_PARTITION) {
        params.push(partition);
        vectorSql += ` AND (s.partition_key = $${params.length} OR (s.partition_key IS NULL AND NOT EXISTS (SELECT 1 FROM unnest(s.tags) t(tag) WHERE lower(tag) LIKE 'partition:%' AND lower(tag) != 'partition:' || $${params.length})))`;
      }

      if (filterTags && filterTags.length > 0) {
        params.push(filterTags);
        vectorSql += ` AND s.tags && $${params.length}::text[]`;
      }

      if (sourceIds && sourceIds.length > 0) {
        params.push(sourceIds);
        vectorSql += ` AND c.source_id = ANY($${params.length}::uuid[])`;
      }

      vectorSql += ` ORDER BY e.vector <=> $1::vector LIMIT $${params.length + 1}`;
      params.push(topK);

      const vectorResults = await query<{
        id: string;
        content: string;
        chunk_index: number;
        source_url: string;
        source_title: string;
        tags: string[];
        owner_user_id: string | null;
        imported_via: string | null;
        metadata_source_origin: string | null;
        discovered_by_run_id: string | null;
        similarity: number;
        evidence_tier: string | null;
      }>(vectorSql, params);

      for (const row of vectorResults) {
        results.set(row.id, {
          id: row.id,
          content: row.content,
          source_url: row.source_url ?? '',
          source_title: row.source_title ?? '',
          chunk_index: row.chunk_index,
          similarity: row.similarity,
          evidence_tier: row.evidence_tier,
          tags: row.tags ?? [],
          owner_user_id: row.discovered_by_run_id === runId ? null : row.owner_user_id,
          source_origin: deriveSourceOrigin(row.metadata_source_origin, row.imported_via),
        });
      }
    }
  } catch (err) {
    logger.warn('Vector search failed, falling back to FTS only:', err);
  }

  // ─── Full-text search (BM25 via ts_rank) ────────────────────────────────
  if (hybridSearch) {
    try {
      let ftsSql = `
        SELECT
          c.id,
          c.content,
          c.chunk_index,
          s.url AS source_url,
          s.title AS source_title,
          s.tags,
          s.imported_via,
          COALESCE(ij.user_id, NULLIF(s.metadata->>'ingested_by_user_id', '')) AS owner_user_id,
          NULLIF(s.metadata->>'source_origin', '') AS metadata_source_origin,
          s.discovered_by_run_id,
          ts_rank(
            to_tsvector('english', c.content),
            plainto_tsquery('english', $1)
          ) AS fts_rank,
          cl.evidence_tier
        FROM chunks c
        LEFT JOIN sources s ON s.id = c.source_id
        LEFT JOIN LATERAL (
          SELECT jobs.user_id
          FROM ingestion_jobs jobs
          WHERE jobs.source_id = s.id
            AND jobs.user_id IS NOT NULL
          ORDER BY jobs.created_at DESC NULLS LAST
          LIMIT 1
        ) ij ON TRUE
        LEFT JOIN claims cl ON cl.chunk_id = c.id
        WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', $1)
      `;

      const ftsParams: unknown[] = [queryText];

      if (partition !== UNCLASSIFIED_PARTITION) {
        ftsParams.push(partition);
        ftsSql += ` AND (s.partition_key = $${ftsParams.length} OR (s.partition_key IS NULL AND NOT EXISTS (SELECT 1 FROM unnest(s.tags) t(tag) WHERE lower(tag) LIKE 'partition:%' AND lower(tag) != 'partition:' || $${ftsParams.length})))`;
      }

      if (filterTags && filterTags.length > 0) {
        ftsParams.push(filterTags);
        ftsSql += ` AND s.tags && $${ftsParams.length}::text[]`;
      }

      if (sourceIds && sourceIds.length > 0) {
        ftsParams.push(sourceIds);
        ftsSql += ` AND c.source_id = ANY($${ftsParams.length}::uuid[])`;
      }

      ftsSql += ` ORDER BY fts_rank DESC LIMIT $${ftsParams.length + 1}`;
      ftsParams.push(Math.ceil(topK / 2));

      const ftsResults = await query<{
        id: string;
        content: string;
        chunk_index: number;
        source_url: string;
        source_title: string;
        tags: string[];
        owner_user_id: string | null;
        imported_via: string | null;
        metadata_source_origin: string | null;
        discovered_by_run_id: string | null;
        fts_rank: number;
        evidence_tier: string | null;
      }>(ftsSql, ftsParams);

      for (const row of ftsResults) {
        const ownerUserId = row.discovered_by_run_id === runId ? null : row.owner_user_id;
        if (!results.has(row.id)) {
          results.set(row.id, {
            id: row.id,
            content: row.content,
            source_url: row.source_url ?? '',
            source_title: row.source_title ?? '',
            chunk_index: row.chunk_index,
            similarity: row.fts_rank * 0.5, // normalize FTS rank
            evidence_tier: row.evidence_tier,
            tags: row.tags ?? [],
            owner_user_id: ownerUserId,
            source_origin: deriveSourceOrigin(row.metadata_source_origin, row.imported_via),
          });
        } else {
          // Boost existing entry; also correct owner if we now know it's a current-run source
          const existing = results.get(row.id)!;
          existing.similarity = Math.min(1, existing.similarity + row.fts_rank * 0.2);
          if (ownerUserId === null) existing.owner_user_id = null;
        }
      }
    } catch (err) {
      logger.warn('FTS search failed:', err);
    }
  }

  const sorted = Array.from(results.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);

  const requiresIndependentSources = intentNeedsIndependentExternalEvidence(intentId);
  const citableChunks: RetrievedChunk[] = [];
  for (const chunk of sorted) {
    if (requiresIndependentSources && chunk.source_origin === 'researchone_generated') {
      backgroundResults.set(chunk.id, chunk);
      continue;
    }
    citableChunks.push(chunk);
  }

  corpusGate.citableChunks = citableChunks.length;
  corpusGate.backgroundChunks = backgroundResults.size;

  return {
    citableChunks,
    backgroundChunks: Array.from(backgroundResults.values()),
    corpusGate,
  };
}

/** Scoped retrieval for revision supplemental sources tagged with revision_request_id. */
export async function retrieveRevisionSupplementalChunks(args: {
  reportId: string;
  revisionRequestId: string;
  queryText: string;
  topK?: number;
}): Promise<RetrievedChunk[]> {
  const sourceRows = await query<{ source_id: string }>(
    `SELECT DISTINCT resolved.source_id
       FROM ingestion_jobs ij
       CROSS JOIN LATERAL (
         SELECT ij.source_id AS source_id
          WHERE ij.source_id IS NOT NULL
         UNION ALL
         SELECT s.id AS source_id
           FROM sources s
          WHERE ij.source_id IS NULL
            AND ij.status = 'completed'
            AND (
              (ij.url IS NOT NULL AND s.url = ij.url)
              OR (ij.file_name IS NOT NULL AND s.original_filename = ij.file_name)
            )
          LIMIT 1
       ) resolved
      WHERE ij.metadata->>'revision_request_id' = $1
        AND ij.metadata->>'report_id' = $2
        AND resolved.source_id IS NOT NULL`,
    [args.revisionRequestId, args.reportId]
  );
  const sourceIds = sourceRows.map((r) => r.source_id).filter(Boolean);
  if (sourceIds.length === 0) return [];

  return retrieveChunks({
    query: args.queryText,
    topK: args.topK ?? 12,
    hybridSearch: true,
    sourceIds,
  });
}

function formatRetrievedChunksForPrompt(chunks: RetrievedChunk[]): string {
  if (chunks.length === 0) return '';
  return chunks
    .map((c, i) =>
      [
        `[RETRIEVED ${i + 1}] ${c.source_title || c.source_url || 'Unknown source'}`,
        c.content,
      ].join('\n')
    )
    .join('\n\n---\n\n');
}

export { formatRetrievedChunksForPrompt };

async function loadCorpusSourceStats(args: {
  filterTags?: string[];
  sourceIds?: string[];
}): Promise<{ records: CorpusSourceRecord[]; globalTotalChunks: number; failClosedReason?: string }> {
  try {
    const params: unknown[] = [];
    const sourceFilters: string[] = [];
    if (args.filterTags && args.filterTags.length > 0) {
      params.push(args.filterTags);
      sourceFilters.push(`s.tags && $${params.length}::text[]`);
    }
    if (args.sourceIds && args.sourceIds.length > 0) {
      params.push(args.sourceIds);
      sourceFilters.push(`s.id = ANY($${params.length}::uuid[])`);
    }
    const whereClause = sourceFilters.length > 0 ? `WHERE ${sourceFilters.join(' AND ')}` : '';

    const records = await query<{
      source_id: string;
      source_url: string | null;
      tags: string[] | null;
      published_at: string | null;
      ingested_at: string | null;
      owner_user_id: string | null;
      imported_via: string | null;
      metadata_source_origin: string | null;
      partition_key: string | null;
      chunk_count: number;
    }>(
      `SELECT
         s.id AS source_id,
         s.url AS source_url,
         s.tags,
         s.published_at,
         s.ingested_at,
         s.imported_via,
         NULLIF(s.metadata->>'source_origin', '') AS metadata_source_origin,
         COALESCE(ij.user_id, NULLIF(s.metadata->>'ingested_by_user_id', '')) AS owner_user_id,
         s.partition_key,
         COUNT(DISTINCT c.id)::int AS chunk_count
       FROM sources s
       LEFT JOIN LATERAL (
         SELECT jobs.user_id
         FROM ingestion_jobs jobs
         WHERE jobs.source_id = s.id
           AND jobs.user_id IS NOT NULL
         ORDER BY jobs.created_at DESC NULLS LAST
         LIMIT 1
       ) ij ON TRUE
       LEFT JOIN chunks c ON c.source_id = s.id
       ${whereClause}
       GROUP BY s.id, s.url, s.tags, s.published_at, s.ingested_at, ij.user_id, s.metadata, s.partition_key`,
      params,
    );

    const globalStats = await query<{ total_sources: number; total_chunks: number }>(
      `SELECT
         COUNT(DISTINCT s.id)::int AS total_sources,
         COUNT(DISTINCT c.id)::int AS total_chunks
       FROM sources s
       LEFT JOIN chunks c ON c.source_id = s.id`
    );

    return {
      records: records.map((record) => ({
        sourceId: record.source_id,
        sourceUrl: record.source_url,
        tags: record.tags ?? [],
        publishedAt: record.published_at,
        ingestedAt: record.ingested_at,
        ownerUserId: record.owner_user_id,
        sourceOrigin: deriveSourceOrigin(record.metadata_source_origin, record.imported_via),
        partitionKey: record.partition_key,
        chunkCount: record.chunk_count ?? 0,
      })),
      globalTotalChunks: globalStats[0]?.total_chunks ?? 0,
    };
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42703' || pgCode === '42P01') {
      logger.warn('corpus_gate_fail_closed_deploy_skew', {
        code: pgCode,
        message: err instanceof Error ? err.message : String(err),
      });
      return {
        records: [],
        globalTotalChunks: 0,
        failClosedReason: `corpus gate unavailable due to deploy skew (${pgCode})`,
      };
    }

    throw err;
  }
}
