import { Router } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { researchQueue } from '../../queue/queues';
import { markRunCancelled } from '../../services/researchCancellation';

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

    await researchQueue.add(
      'research-run',
      {
        runId,
        query: researchQuery,
        supplemental,
        filterTags,
      },
      { jobId: runId }
    );

    res.status(202).json({ runId, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// GET /api/research - List research runs
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };
    let sql = `SELECT id, title, query, status, error_message, failed_stage, failure_meta,
                      progress_stage, progress_percent, progress_message, progress_updated_at,
                      started_at, completed_at, created_at
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

// POST /api/research/:id/cancel — cancel queued or cooperatively stop running
router.post('/:id/cancel', async (req, res, next) => {
  try {
    const rows = await query<{ id: string; status: string }>(
      `SELECT id, status FROM research_runs WHERE id=$1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const { status } = rows[0];
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      res.status(400).json({ error: `Cannot cancel run in status ${status}` });
      return;
    }
    if (status === 'queued') {
      const job = await researchQueue.getJob(req.params.id);
      if (job) {
        await job.remove();
      }
      await query(
        `UPDATE research_runs SET status='cancelled', completed_at=NOW(), error_message='Cancelled by user' WHERE id=$1`,
        [req.params.id]
      );
      res.json({ ok: true, status: 'cancelled' });
      return;
    }
    if (status === 'running') {
      await markRunCancelled(req.params.id);
      res.json({ ok: true, status: 'cancellation_requested' });
      return;
    }
    res.status(400).json({ error: 'Unexpected run status' });
  } catch (err) {
    next(err);
  }
});

// DELETE /api/research/:id — remove terminal or queued run row
router.delete('/:id', async (req, res, next) => {
  try {
    const rows = await query<{ status: string }>(
      `SELECT status FROM research_runs WHERE id=$1`,
      [req.params.id]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const { status } = rows[0];
    if (status === 'running') {
      res.status(400).json({ error: 'Cannot delete a running run; cancel first' });
      return;
    }
    if (status === 'queued') {
      const job = await researchQueue.getJob(req.params.id);
      if (job) await job.remove();
    }
    await query(`DELETE FROM research_runs WHERE id=$1`, [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
