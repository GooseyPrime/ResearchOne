import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { atlasExportQueue } from '../../queue/queues';
import * as fs from 'fs';
import { uploadAtlasJsonlToNomic } from '../../services/embedding/nomicUpload';
import { config } from '../../config';

const router = Router();

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

// GET /api/atlas/points - Get sample points with 2D projected coordinates for in-browser visualization.
// Uses a seeded random projection matrix (Johnson-Lindenstrauss) to project high-dimensional
// embedding vectors to 2D. The same seed is always used so coordinates are stable across calls.
router.get('/points', async (req, res, next) => {
  try {
    const { limit = '500', tags } = req.query as { limit?: string; tags?: string };
    const lim = Math.min(parseInt(limit, 10), 2000);

    const filterTags = tags ? tags.split(',').map((t: string) => t.trim()).filter(Boolean) : null;

    const params: unknown[] = [lim];
    let tagFilter = '';
    if (filterTags && filterTags.length > 0) {
      params.push(filterTags);
      tagFilter = `AND s.tags && $${params.length}::text[]`;
    }

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
         cl.evidence_tier,
         e.vector::text AS vector_str
       FROM chunks c
       JOIN embeddings e ON e.chunk_id = c.id
       LEFT JOIN sources s ON s.id = c.source_id
       LEFT JOIN claims cl ON cl.chunk_id = c.id
       WHERE e.vector IS NOT NULL ${tagFilter}
       ORDER BY RANDOM()
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
        text: row.content.slice(0, 200),
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
