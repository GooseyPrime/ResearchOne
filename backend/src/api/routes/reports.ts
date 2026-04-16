import { Router } from 'express';
import { query } from '../../db/pool';
import {
  createReportRevision,
  getReportRevision,
  listReportRevisions,
} from '../../services/reasoning/reportRevisionService';

const router = Router();

// GET /api/reports - List reports
router.get('/', async (req, res, next) => {
  try {
    const { status, search } = req.query as { status?: string; search?: string };
    let sql = `
      SELECT r.id, r.title, r.query, r.status, r.executive_summary,
              r.source_count, r.chunk_count, r.contradiction_count,
              r.finalized_at, r.created_at, r.version_number,
              r.root_report_id, r.parent_report_id
      FROM reports r
      WHERE 1=1
    `;
    const params: unknown[] = [];

    if (status) {
      params.push(status);
      sql += ` AND r.status=$${params.length}`;
    }

    if (search) {
      params.push(search);
      sql += ` AND to_tsvector('english', coalesce(r.title,'') || ' ' || coalesce(r.executive_summary,'')) @@ plainto_tsquery('english', $${params.length})`;
    }

    sql += ' ORDER BY r.created_at DESC LIMIT 100';
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id - Get full report with sections
router.get('/:id', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT * FROM reports WHERE id=$1`,
      [req.params.id]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const sections = await query(
      `SELECT * FROM report_sections WHERE report_id=$1 ORDER BY section_order`,
      [req.params.id]
    );

    res.json({ ...rows[0], sections });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/:id/revisions - Request and apply a report revision
router.post('/:id/revisions', async (req, res, next) => {
  try {
    const {
      requestText,
      rationale,
      initiatedBy,
      initiatedByType,
    } = req.body as {
      requestText?: string;
      rationale?: string;
      initiatedBy?: string;
      initiatedByType?: string;
    };

    if (!requestText || typeof requestText !== 'string') {
      res.status(400).json({ error: 'requestText is required' });
      return;
    }

    const io = req.app.get('io') as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
    const emitProgress = (payload: unknown) => {
      io?.to(`job:revision:${req.params.id}`).emit('revision:progress', payload);
      io?.to(`job:${req.params.id}`).emit('revision:progress', payload);
      io?.to('reports').emit('revision:progress', payload);
    };

    const result = await createReportRevision({
      reportId: req.params.id,
      requestText,
      rationale,
      initiatedBy,
      initiatedByType,
      onProgress: emitProgress,
    });

    io?.to(`job:revision:${req.params.id}`).emit('revision:completed', result);
    io?.to('reports').emit('reports:updated', {});
    res.status(202).json(result);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/revisions - list revision history
router.get('/:id/revisions', async (req, res, next) => {
  try {
    const revisions = await listReportRevisions(req.params.id);
    res.json(revisions);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/revisions/:revisionId - revision detail
router.get('/:id/revisions/:revisionId', async (req, res, next) => {
  try {
    const revision = await getReportRevision(req.params.id, req.params.revisionId);
    if (!revision) {
      res.status(404).json({ error: 'Revision not found' });
      return;
    }
    res.json(revision);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/citations - Get all citations for a report
router.get('/:id/citations', async (req, res, next) => {
  try {
    const citations = await query(
      `SELECT rc.*, s.url AS source_url, s.title AS source_title
       FROM report_citations rc
       LEFT JOIN sources s ON s.id = rc.source_id
       WHERE rc.report_id=$1`,
      [req.params.id]
    );
    res.json(citations);
  } catch (err) {
    next(err);
  }
});

export default router;
