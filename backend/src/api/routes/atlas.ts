import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { atlasExportQueue } from '../../queue/queues';
import * as fs from 'fs';

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

    res.status(202).json({ exportId, status: 'queued' });
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

// GET /api/atlas/points - Get sample points for visualization
router.get('/points', async (req, res, next) => {
  try {
    const { limit = '500' } = req.query as { limit?: string };
    const lim = Math.min(parseInt(limit, 10), 2000);

    const rows = await query(
      `SELECT
         c.id,
         c.content,
         c.chunk_index,
         s.url AS source_url,
         s.title AS source_title,
         s.tags,
         e.vector::text AS vector_str
       FROM chunks c
       JOIN embeddings e ON e.chunk_id = c.id
       LEFT JOIN sources s ON s.id = c.source_id
       WHERE e.vector IS NOT NULL
       ORDER BY RANDOM()
       LIMIT $1`,
      [lim]
    );

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

export default router;
