import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { atlasExportQueue } from '../../queue/queues';
import * as fs from 'fs';
import { uploadAtlasJsonlToNomic } from '../../services/embedding/nomicUpload';
import { config } from '../../config';

const router = Router();

router.use(requireAuth);

// POST /api/atlas/export - Trigger an Atlas export
router.post('/export', async (req, res, next) => {
  try {
    const { label, description, filterTags } = req.body as {
      label: string;
      description?: string;
      filterTags?: string[];
    };

    if (!label) {
      res.status(400).json({ error: 'label is required' });
      return;
    }

    const exportId = uuidv4();
    await query(
      `INSERT INTO atlas_exports (id, label, description, filter_tags) VALUES ($1, $2, $3, $4)`,
      [exportId, label, description ?? '', filterTags ?? []]
    );

    await atlasExportQueue.add('atlas-export', { exportId, label, description, filterTags });

    res.status(202).json({ exportId, status: 'queued', nomicAutoUpload: true, chunkCount: 0 });
  } catch (err) {
    next(err);
  }
});

// GET /api/atlas/exports - List exports
router.get('/exports', async (_req, res, next) => {
  try {
    res.json(await query(`SELECT * FROM atlas_exports ORDER BY created_at DESC LIMIT 50`));
  } catch (err) {
    next(err);
  }
});

// GET /api/atlas/exports/:id/download - Download export file
router.get('/exports/:id/download', async (req, res, next) => {
  try {
    const rows = await query<{ export_path: string; label: string }>(
      `SELECT export_path, label FROM atlas_exports WHERE id=$1`,
      [req.params.id]
    );

    if (rows.length === 0 || !rows[0].export_path) {
      res.status(404).json({ error: 'Export not found or not ready' });
      return;
    }

    const filePath = rows[0].export_path;
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: 'Export file not found' });
      return;
    }

    res.download(filePath, `atlas_${rows[0].label}.jsonl`);
  } catch (err) {
    next(err);
  }
});

// GET /api/atlas/embedded-count — total embedded chunks, optionally
// filtered by tag. Used by the EmbeddingAtlasPage to show
// "rendering N of M" so the user knows when their selected limit is
// truncating the live corpus.
router.get('/embedded-count', async (req, res, next) => {
  try {
    const { tags } = req.query as { tags?: string };
    const filterTags = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null;
    const params: unknown[] = [];
    let tagFilter = '';
    if (filterTags && filterTags.length > 0) {
      params.push(filterTags);
      tagFilter = `AND s.tags && $${params.length}::text[]`;
    }
    const rows = await query<{ count: number | string }>(
      `SELECT COUNT(*)::int AS count
       FROM chunks c
       JOIN embeddings e ON e.chunk_id = c.id
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE e.vector IS NOT NULL ${tagFilter}`,
      params
    );
    res.json({ count: Number(rows[0]?.count ?? 0) });
  } catch (err) {
    next(err);
  }
});

// GET /api/atlas/points - Get sample points with 2D projected coordinates for in-browser visualization.
// Uses a seeded random projection matrix (Johnson-Lindenstrauss) to project high-dimensional
// embedding vectors to 2D. The same seed is always used so coordinates are stable across calls.
//
// Supports a "full corpus" render path via limit=full (or any limit
// requesting >= ATLAS_FULL_CORPUS_LIMIT). Requests are capped at
// ATLAS_FULL_CORPUS_LIMIT to keep the JSON payload + d3 force layout
// within browser memory, and the endpoint returns up to that many
// points.
router.get('/points', async (req, res, next) => {
  try {
    const { limit = '500', tags } = req.query as { limit?: string; tags?: string };
    const ATLAS_FULL_CORPUS_LIMIT = 10000;
    let lim: number;
    if (limit === 'full' || limit === 'all') {
      lim = ATLAS_FULL_CORPUS_LIMIT;
    } else {
      const parsedLimit = parseInt(limit, 10);
      lim = Math.min(Number.isFinite(parsedLimit) ? Math.max(1, parsedLimit) : 500, ATLAS_FULL_CORPUS_LIMIT);
    }

    const filterTags = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null;

    const params: unknown[] = [lim];
    let tagFilter = '';
    if (filterTags && filterTags.length > 0) {
      params.push(filterTags);
      tagFilter = `AND s.tags && $${params.length}::text[]`;
    }

    // Pick the highest-ranked claim that links to this chunk, in either
    // direction:
    //   - claims.chunk_id  (set for the "first" supporting chunk only — see
    //     claimExtractor.ts which writes only supporting_chunk_ids[0] there)
    //   - claims.supporting_chunk_ids[]  (the full evidence list)
    // Without the array check, only ~1 chunk per claim ever gets a tier and
    // every other point on the embedding atlas falls back to "unclassified".
    // Order by tier strength so ties resolve to the strongest classification.
    const rows = await query<{
      id: string;
      content: string;
      chunk_index: number;
      source_url: string;
      source_title: string;
      tags: string[];
      evidence_tier: string | null;
      vector_str: string;
    }>(
      `SELECT
         c.id,
         c.content,
         c.chunk_index,
         s.url AS source_url,
         s.title AS source_title,
         COALESCE(s.tags, '{}') AS tags,
         (
           SELECT cl.evidence_tier
             FROM claims cl
            WHERE cl.chunk_id = c.id
               OR c.id = ANY(cl.supporting_chunk_ids)
            ORDER BY CASE cl.evidence_tier
              WHEN 'established_fact' THEN 1
              WHEN 'strong_evidence'  THEN 2
              WHEN 'testimony'        THEN 3
              WHEN 'inference'        THEN 4
              WHEN 'speculation'      THEN 5
              ELSE 6
            END
            LIMIT 1
         ) AS evidence_tier,
         e.vector::text AS vector_str
       FROM chunks c
       JOIN embeddings e ON e.chunk_id = c.id
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE e.vector IS NOT NULL ${tagFilter}
       ORDER BY c.id
       LIMIT $1`,
      params
    );

    if (rows.length === 0) {
      res.json([]);
      return;
    }

    // Parse first vector to get dimensionality
    const firstVec = parseVector(rows[0].vector_str);
    const dim = firstVec.length;

    // Build a seeded random projection matrix: dim × 2.
    // Seed is fixed so projected coordinates are stable across requests.
    const projMatrix = buildRandomProjection(dim, 2, 42);

    const points = rows.map((row) => {
      const vec = parseVector(row.vector_str);
      const [x, y] = project(vec, projMatrix);
      return {
        id: row.id,
        text: presentableChunkText(row.content),
        source_url: row.source_url ?? '',
        source_title: row.source_title ?? '',
        tags: row.tags ?? [],
        evidence_tier: row.evidence_tier,
        chunk_index: row.chunk_index,
        x,
        y,
      };
    });

    res.json(points);
  } catch (err) {
    next(err);
  }
});

/**
 * Some PDFs in the corpus came from `pdf-parse` runs where the extracted
 * "text" is actually mojibake from a font with no Unicode mapping (CID
 * fonts, scanned images, etc.). Those chunks land in the DB as long
 * strings of replacement characters and box-drawing punctuation, which
 * then show up on the embedding atlas tooltip as "encrypted-looking" goo.
 *
 * We can't undo the bad extraction, but we can keep the API from returning
 * the goo as-is. If the printable-ASCII ratio is too low we surface a
 * placeholder note instead so the user knows the chunk exists but its text
 * is not human-readable.
 */
function presentableChunkText(content: string): string {
  const slice = content.slice(0, 400);
  if (!slice) return '';
  // Count ASCII letters, digits, and common punctuation. Bad-extraction
  // strings are dominated by replacement chars (U+FFFD), box drawings,
  // and other control bytes — those don't match this class.
  let printable = 0;
  for (let i = 0; i < slice.length; i++) {
    const code = slice.charCodeAt(i);
    const isAsciiText = code === 9 || code === 10 || code === 13 || (code >= 32 && code <= 126);
    const isCommonLatin = code >= 0x00a0 && code <= 0x024f;
    if (isAsciiText || isCommonLatin) printable++;
  }
  const ratio = printable / slice.length;
  if (ratio < 0.6) {
    return '[chunk text not human-readable — likely from a scanned/CID-font PDF; the embedding is still valid]';
  }
  return slice.slice(0, 200);
}

function parseVector(str: string): number[] {
  // pgvector format: '[0.1,0.2,...]'
  return str.replace(/^\[|\]$/g, '').split(',').map(Number);
}

function buildRandomProjection(inputDim: number, outputDim: number, seed: number): number[][] {
  // Simple LCG RNG for reproducibility
  let s = seed >>> 0;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return (s / 0x100000000) * 2 - 1; // uniform [-1, 1]
  };
  // Each column is a random unit vector in inputDim space
  const matrix: number[][] = [];
  for (let j = 0; j < outputDim; j++) {
    const col: number[] = [];
    let norm = 0;
    for (let i = 0; i < inputDim; i++) {
      const v = rand();
      col.push(v);
      norm += v * v;
    }
    norm = Math.sqrt(norm);
    matrix.push(col.map((v) => v / norm));
  }
  return matrix;
}

function project(vec: number[], matrix: number[][]): number[] {
  return matrix.map((col) => {
    let dot = 0;
    for (let i = 0; i < vec.length; i++) dot += vec[i] * col[i];
    return dot;
  });
}

// POST /api/atlas/exports/:id/nomic-upload - Upload existing atlas export to Nomic dataset
router.post('/exports/:id/nomic-upload', async (req, res, next) => {
  try {
    const rows = await query<{ export_path: string; label: string }>(
      `SELECT export_path, label FROM atlas_exports WHERE id=$1`,
      [req.params.id]
    );
    if (rows.length === 0 || !rows[0].export_path) {
      res.status(404).json({ error: 'Export not found or not ready' });
      return;
    }
    if (!config.nomic.apiKey.trim()) {
      res.status(400).json({ error: 'NOMIC_API_KEY is not configured on the backend' });
      return;
    }
    const datasetSlug = (req.body?.datasetSlug as string | undefined)?.trim() || config.nomic.atlasDatasetSlug;
    const result = await uploadAtlasJsonlToNomic({
      exportPath: rows[0].export_path,
      datasetSlug,
    });
    await query(
      `UPDATE atlas_exports
          SET description = trim(concat_ws(E'\n', description, $1))
        WHERE id=$2`,
      [`Nomic upload: ${result.datasetUrl}`, req.params.id]
    );
    res.json({ ok: true, ...result });
  } catch (err) {
    next(err);
  }
});

export default router;
