/**
 * AUDIT (epistemic): No LLM query expansion — user query is embedded and used for FTS as-is.
 * If query rewriting is added, wrap LLM system prompts with withPreamble from constants/prompts.ts.
 */

import { query } from '../../db/pool';
import { generateEmbeddings } from '../openrouter/openrouterService';
import { logger } from '../../utils/logger';

export interface RetrievedChunk {
  id: string;
  content: string;
  source_url: string;
  source_title: string;
  chunk_index: number;
  similarity: number;
  evidence_tier: string | null;
  tags: string[];
}

export interface RetrievalOptions {
  query: string;
  topK?: number;
  minSimilarity?: number;
  filterTags?: string[];
  hybridSearch?: boolean;  // combine vector + full-text
}

/**
 * Hybrid retrieval: combines semantic (vector) search with BM25-style full-text search.
 * Semantic results weighted by cosine similarity; FTS results boosted by relevance rank.
 */
export async function retrieveChunks(options: RetrievalOptions): Promise<RetrievedChunk[]> {
  const {
    query: queryText,
    topK = 20,
    minSimilarity = 0.3,
    filterTags,
    hybridSearch = true,
  } = options;

  const results: Map<string, RetrievedChunk> = new Map();

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
          1 - (e.vector <=> $1::vector) AS similarity,
          cl.evidence_tier
        FROM embeddings e
        JOIN chunks c ON c.id = e.chunk_id
        LEFT JOIN sources s ON s.id = c.source_id
        LEFT JOIN claims cl ON cl.chunk_id = c.id
        WHERE e.vector IS NOT NULL
          AND 1 - (e.vector <=> $1::vector) >= $2
      `;
      const params: unknown[] = [vectorStr, minSimilarity];

      if (filterTags && filterTags.length > 0) {
        params.push(filterTags);
        vectorSql += ` AND s.tags && $${params.length}::text[]`;
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
          ts_rank(
            to_tsvector('english', c.content),
            plainto_tsquery('english', $1)
          ) AS fts_rank,
          cl.evidence_tier
        FROM chunks c
        LEFT JOIN sources s ON s.id = c.source_id
        LEFT JOIN claims cl ON cl.chunk_id = c.id
        WHERE to_tsvector('english', c.content) @@ plainto_tsquery('english', $1)
      `;

      const ftsParams: unknown[] = [queryText];

      if (filterTags && filterTags.length > 0) {
        ftsParams.push(filterTags);
        ftsSql += ` AND s.tags && $${ftsParams.length}::text[]`;
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
        fts_rank: number;
        evidence_tier: string | null;
      }>(ftsSql, ftsParams);

      for (const row of ftsResults) {
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
          });
        } else {
          // Boost existing entry
          const existing = results.get(row.id)!;
          existing.similarity = Math.min(1, existing.similarity + row.fts_rank * 0.2);
        }
      }
    } catch (err) {
      logger.warn('FTS search failed:', err);
    }
  }

  // Sort by combined similarity score, highest first
  return Array.from(results.values())
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}
