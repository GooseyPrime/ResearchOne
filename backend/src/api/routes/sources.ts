import { Router } from 'express';
import { query } from '../../db/pool';

const router = Router();

// GET /api/sources - List sources
router.get('/', async (req, res, next) => {
  try {
    const { type, search } = req.query as { type?: string; search?: string };
    let sql = `
      SELECT s.id, s.url, s.title, s.source_type, s.tags, s.published_at, s.ingested_at,
             COUNT(DISTINCT c.id) AS chunk_count,
             COUNT(DISTINCT e.id) AS embedding_count
      FROM sources s
      LEFT JOIN chunks c ON c.source_id = s.id
      LEFT JOIN embeddings e ON e.chunk_id = c.id
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (type) {
      params.push(type);
      sql += ` AND s.source_type=$${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      sql += ` AND (s.title ILIKE $${params.length} OR s.url ILIKE $${params.length})`;
    }

    sql += ` GROUP BY s.id ORDER BY s.ingested_at DESC LIMIT 200`;
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

// GET /api/sources/:id - Get specific source
router.get('/:id', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT * FROM sources WHERE id=$1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// DELETE /api/sources/:id - Remove a source and all its data
router.delete('/:id', async (req, res, next) => {
  try {
    await query(`DELETE FROM sources WHERE id=$1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
