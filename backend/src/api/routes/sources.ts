import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { adminQuery, query } from '../../db/pool';
import { logger } from '../../utils/logger';
import { libraryViewerFromRequest, ownSourceSql } from '../../db/libraryScope';

const router = Router();

router.use(requireAuth);

// GET /api/sources - List sources
router.get('/', async (req, res, next) => {
  try {
    const viewer = libraryViewerFromRequest(req);
    if (!viewer) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
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

    // A user lists the sources they added; an admin lists the whole library.
    if (!viewer.isAdmin) {
      params.push(viewer.userId);
      sql += ` AND ${ownSourceSql('s', params.length)}`;
    }

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
    const viewer = libraryViewerFromRequest(req);
    if (!viewer) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    // Another user's source answers exactly like one that does not exist.
    const rows = viewer.isAdmin
      ? await query(`SELECT * FROM sources WHERE id=$1`, [req.params.id])
      : await query(
          `SELECT s.* FROM sources s WHERE s.id=$1 AND ${ownSourceSql('s', 2)}`,
          [req.params.id, viewer.userId]
        );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Source not found' });
      return;
    }
    const row = rows[0] as Record<string, unknown>;
    if (!viewer.isAdmin) {
      // A source two users both added keeps one metadata record; never show
      // one user which other account is recorded on it.
      const metadata = row.metadata;
      if (metadata && typeof metadata === 'object' && !Array.isArray(metadata)) {
        const record = { ...(metadata as Record<string, unknown>) };
        if (record.ingested_by_user_id !== viewer.userId) delete record.ingested_by_user_id;
        row.metadata = record;
      }
    }
    res.json(row);
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
    const viewer = libraryViewerFromRequest(req);
    if (!viewer) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (viewer.isAdmin) {
      await query(`DELETE FROM sources WHERE id=$1`, [req.params.id]);
      res.json({ deleted: true });
      return;
    }
    const userId = viewer.userId;

    let ownership: { is_own: boolean | null; other_owners: number | string | null } | null;
    try {
      // Read outside the caller's row-level scope: counting OTHER owners needs
      // to see their rows. The caller is named explicitly in the query.
      const ownershipRows = await adminQuery<{ is_own: boolean | null; other_owners: number | string | null }>(
        `SELECT ${ownSourceSql('s', 2)} AS is_own,
                (
                  (SELECT COUNT(*) FROM ingestion_jobs oj
                    WHERE oj.source_id = s.id AND oj.user_id IS NOT NULL AND oj.user_id <> $2::text)
                  + (SELECT COUNT(*) FROM research_runs orr
                      WHERE orr.id = s.discovered_by_run_id AND orr.user_id IS NOT NULL AND orr.user_id <> $2::text)
                  + (CASE WHEN NULLIF(s.metadata->>'ingested_by_user_id', '') IS NOT NULL
                           AND s.metadata->>'ingested_by_user_id' <> $2::text THEN 1 ELSE 0 END)
                )::int AS other_owners
           FROM sources s
          WHERE s.id = $1`,
        [req.params.id, userId]
      );
      ownership = ownershipRows[0] ?? null;
    } catch (err) {
      const pgCode = (err as { code?: string })?.code;
      if (pgCode === '42703') {
        logger.warn('legacy_unscoped_delete', { route: 'DELETE /api/sources/:id' });
        res.status(403).json({ error: 'You can only delete sources you ingested' });
        return;
      }
      throw err;
    }

    if (!ownership || ownership.is_own !== true) {
      res.status(403).json({ error: 'You can only delete sources you ingested' });
      return;
    }

    // A source another user also added is theirs too: the caller's link to it
    // is removed and the source stays for the other owner.
    if (Number(ownership.other_owners ?? 0) > 0) {
      await query(`UPDATE ingestion_jobs SET source_id = NULL WHERE source_id = $1 AND user_id = $2`, [
        req.params.id,
        userId,
      ]);
      res.json({ deleted: true });
      return;
    }

    await query(`DELETE FROM sources WHERE id=$1`, [req.params.id]);
    res.json({ deleted: true });
  } catch (err) {
    next(err);
  }
});

export default router;
