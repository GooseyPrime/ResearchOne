/**
 * AUDIT (embedding integrity): Chunk text is read from DB and passed directly to generateEmbeddings (no LLM rewrite).
 */

import { query, withTransaction } from '../../db/pool';
import { generateEmbeddings } from '../openrouter/openrouterService';
import { config } from '../../config';
import { logger } from '../../utils/logger';

export interface EmbeddingJobData {
  sourceId: string;
  chunkIds: string[];
}

type ProgressCallback = (progress: { percent: number; message: string }) => void;

export async function runEmbeddingJob(
  data: EmbeddingJobData,
  onProgress: ProgressCallback
): Promise<{ embedded: number }> {
  const { chunkIds } = data;
  const batchSize = config.embedding.batchSize;
  let embedded = 0;

  for (let i = 0; i < chunkIds.length; i += batchSize) {
    const batchIds = chunkIds.slice(i, i + batchSize);

    // Fetch chunk content
    const chunks = await query<{ id: string; content: string }>(
      `SELECT id, content FROM chunks WHERE id = ANY($1::uuid[])`,
      [batchIds]
    );

    if (chunks.length === 0) continue;

    const texts = chunks.map(c => c.content);

    try {
      // Belt-and-suspenders: if this batch's estimated token payload exceeds
      // ~50k tokens (rough: chars / 3.5), split into micro-batches so a single
      // generateEmbeddings call never carries an outsized payload even if
      // EMBEDDING_BATCH_SIZE was set high via env. Each micro-batch is still
      // capped by the per-string truncation guard inside generateEmbeddings.
      const estimatedTokens = texts.reduce((sum, t) => sum + t.length, 0) / 3.5;
      const SAFE_TOKEN_BUDGET = 50000;
      let vectors: number[][] = [];
      if (estimatedTokens > SAFE_TOKEN_BUDGET) {
        const microSize = Math.max(1, Math.floor(texts.length * (SAFE_TOKEN_BUDGET / estimatedTokens)));
        logger.warn(`Embedding batch estimated ${Math.round(estimatedTokens)} tokens; splitting into micro-batches of ${microSize}`, { sourceId: data.sourceId, batchLen: texts.length });
        for (let m = 0; m < texts.length; m += microSize) {
          const micro = await generateEmbeddings(texts.slice(m, m + microSize));
          vectors.push(...micro);
        }
      } else {
        vectors = await generateEmbeddings(texts);
      }

      await withTransaction(async (client) => {
        for (let j = 0; j < chunks.length; j++) {
          const chunk = chunks[j];
          const vector = vectors[j];

          if (!vector || vector.length === 0) continue;

          // Format vector for pgvector: '[0.1, 0.2, ...]'
          const vectorStr = `[${vector.join(',')}]`;

          await client.query(
            `INSERT INTO embeddings (chunk_id, model, dimensions, vector)
             VALUES ($1, $2, $3, $4::vector)
             ON CONFLICT (chunk_id) DO UPDATE
             SET vector=$4::vector, model=$2, dimensions=$3`,
            [chunk.id, config.models.embedding, vector.length, vectorStr]
          );
        }
      });

      embedded += chunks.length;
      const percent = Math.round((i + batchSize) / chunkIds.length * 100);
      onProgress({ percent: Math.min(percent, 99), message: `Embedded ${embedded}/${chunkIds.length} chunks` });

    } catch (err) {
      logger.error(`Embedding batch failed for source ${data.sourceId}:`, err);
      throw err;
    }
  }

  onProgress({ percent: 100, message: `Embedding complete: ${embedded} chunks` });
  return { embedded };
}
