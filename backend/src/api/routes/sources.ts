import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { query, queryOne } from '../../db/pool';
import { logger } from '../../utils/logger';
import { config } from '../../config';

const router = Router();

router.use(requireAuth);

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

// DELETE /api/sources/:id - Remove a source and all its data.
// Restricted: admin-only, or the user who ingested the source.
// Ownership is checked via:
//   1. discovered_by_run_id -> research_runs.user_id (autonomous discovery)
//   2. ingestion_jobs.source_id -> ingestion_jobs.user_id (manual ingest seed)
//   3. sources.metadata.ingested_by_user_id (site-crawl child pages, PR #162)
router.delete('/:id', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    const isAdmin = !!(userId && config.admin.userIds.includes(userId));
    if (isAdmin) {
      await query(`DELETE FROM sources WHERE id=$1`, [req.params.id]);
      res.json({ deleted: true });
      return;
    }
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    let isOwner = false;
    try {
      const row = await queryOne<{ owner_user_id: string | null }>(
        `SELECT COALESCE(
           r.user_id,
           ij.user_id,
           NULLIF(s.metadata->>'ingested_by_user_id', '')
         ) AS owner_user_id
         FROM sources s
         LEFT JOIN research_runs r ON r.id = s.discovered_by_run_id
         LEFT JOIN ingestion_jobs ij ON ij.source_id = s.id
         WHERE s.id = $1
         LIMIT 1`,
        [req.params.id]
      );
      isOwner = row?.owner_user_id === userId;
    } catch (err) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '42703') {
        logger.warn('legacy_unscoped_delete', { route: 'DELETE /api/sources/:id' });
        res.status(403).json({ error: 'You can only delete sources you ingested' });
        return;
      }
      throw err;
    }

    if (!isOwner) {
      res.status(403).json({ error: 'You can only delete sources you ingested' });
      return;
    }

    await query(`DELETE FROM sources WHERE id=$1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
