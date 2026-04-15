import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { researchQueue } from '../../queue/queues';

const router = Router();

// POST /api/research - Start a research run
router.post('/', async (req, res, next) => {
  try {
    const { query: researchQuery, supplemental, filterTags } = req.body as {
      query: string;
      supplemental?: string;
      filterTags?: string[];
    };

    if (!researchQuery || typeof researchQuery !== 'string') {
      res.status(400).json({ error: 'query is required' });
      return;
    }

    const runId = uuidv4();
    const title = researchQuery.slice(0, 200);

    await query(
      `INSERT INTO research_runs (id, title, query, supplemental, status)
       VALUES ($1, $2, $3, $4, 'queued')`,
      [runId, title, researchQuery, supplemental ?? '']
    );

    await researchQueue.add('research-run', {
      runId,
      query: researchQuery,
      supplemental,
      filterTags,
    });

    res.status(202).json({ runId, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// GET /api/research - List research runs
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };
    let sql = `SELECT id, title, query, status, error_message, started_at, completed_at, created_at
               FROM research_runs`;
    const params: string[] = [];
    if (status) {
      params.push(status);
      sql += ` WHERE status=$1`;
    }
    sql += ' ORDER BY created_at DESC LIMIT 50';
    res.json(await query(sql, params));
  } catch (err) {
    next(err);
  }
});

// GET /api/research/:id - Get specific run
router.get('/:id', async (req, res, next) => {
  try {
    const rows = await query(
      `SELECT * FROM research_runs WHERE id=$1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
