import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { researchQueue } from '../../queue/queues';
import { markRunCancelled } from '../../services/researchCancellation';
import { validatePerRunModelOverrides } from '../../services/runtimeModelStore';
import { APPROVED_REASONING_MODEL_ALLOWLIST } from '../../services/reasoning/reasoningModelPolicy';
import { config } from '../../config';
import { ingestSupplementalForRun } from '../../services/research/researchSupplementalIngest';

const router = Router();

const uploadResearch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024, files: 25 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'application/octet-stream',
    ];
    const ok =
      allowed.includes(file.mimetype) ||
      file.originalname.endsWith('.md') ||
      file.originalname.endsWith('.txt') ||
      file.originalname.endsWith('.pdf');
    if (ok) cb(null, true);
    else cb(new Error(`Unsupported supplemental file type: ${file.mimetype} (${file.originalname})`));
  },
});

function parseJsonField<T>(raw: unknown, fallback: T): T {
  if (raw === undefined || raw === null || raw === '') return fallback;
  if (typeof raw === 'object') return raw as T;
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return fallback;
    }
  }
  return fallback;
}

// POST /api/research - Start a research run (JSON or multipart with supplemental files)
router.post(
  '/',
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      uploadResearch.array('files', 25)(req, res, next);
    } else {
      next();
    }
  },
  async (req, res, next) => {
    try {
      const isMultipart = Boolean(req.headers['content-type']?.includes('multipart/form-data'));
      const body = req.body as Record<string, string | undefined> & {
        filterTags?: string[] | string;
        modelOverrides?: unknown;
        supplementalUrls?: string[];
      };

      const researchQuery = typeof body.query === 'string' ? body.query : '';
      const supplemental = typeof body.supplemental === 'string' ? body.supplemental : '';

      let filterTags: string[] | undefined;
      if (isMultipart) {
        const rawFt = body.filterTags as unknown;
        if (Array.isArray(rawFt)) {
          filterTags = rawFt.map((t) => String(t));
        } else if (typeof rawFt === 'string' && rawFt.trim()) {
          const ftParsed = parseJsonField<unknown>(rawFt, null);
          if (Array.isArray(ftParsed)) filterTags = ftParsed.map((t) => String(t));
          else filterTags = rawFt.split(',').map((t) => t.trim()).filter(Boolean);
        }
      } else {
        const jsonBody = req.body as { filterTags?: string[] };
        filterTags = Array.isArray(jsonBody.filterTags) ? jsonBody.filterTags : undefined;
      }

      let modelOverrides: unknown;
      if (isMultipart) {
        const rawMo = body.modelOverrides as unknown;
        if (typeof rawMo === 'string') modelOverrides = parseJsonField(rawMo, undefined);
        else modelOverrides = rawMo;
      } else {
        modelOverrides = (req.body as { modelOverrides?: unknown }).modelOverrides;
      }

      let supplementalUrls: string[] = [];
      if (isMultipart) {
        const rawSu = body.supplementalUrls as unknown;
        const parsed =
          typeof rawSu === 'string' ? parseJsonField<unknown[]>(rawSu, []) : Array.isArray(rawSu) ? rawSu : [];
        supplementalUrls = Array.isArray(parsed) ? parsed.map((u) => String(u).trim()).filter(Boolean) : [];
      } else {
        const jsonBody = req.body as { supplementalUrls?: string[] };
        supplementalUrls = Array.isArray(jsonBody.supplementalUrls)
          ? jsonBody.supplementalUrls.map((u) => String(u).trim()).filter(Boolean)
          : [];
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (!researchQuery || typeof researchQuery !== 'string') {
        res.status(400).json({ error: 'query is required' });
        return;
      }

      const normalizedOverrides = modelOverrides ? validatePerRunModelOverrides(modelOverrides) : { overrides: {} };

      const runId = uuidv4();
      const title = researchQuery.slice(0, 200);

      const fileItems = files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
      }));

      const ingestSummary = await ingestSupplementalForRun({
        runId,
        urls: supplementalUrls,
        files: fileItems,
      });

      const attachments: Array<
        | { kind: 'url'; url: string; ingestion_job_id: string }
        | { kind: 'file'; filename: string; mimetype: string; ingestion_job_id: string }
      > = [];

      let jobIdx = 0;
      for (const u of supplementalUrls) {
        const jid = ingestSummary.jobIds[jobIdx];
        if (jid) attachments.push({ kind: 'url', url: u, ingestion_job_id: jid });
        jobIdx += 1;
      }
      for (const f of fileItems) {
        const jid = ingestSummary.jobIds[jobIdx];
        if (jid) attachments.push({ kind: 'file', filename: f.originalname, mimetype: f.mimetype, ingestion_job_id: jid });
        jobIdx += 1;
      }

      await query(
        `INSERT INTO research_runs (id, title, query, supplemental, status, model_overrides, supplemental_attachments)
         VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb)`,
        [runId, title, researchQuery, supplemental ?? '', JSON.stringify(normalizedOverrides), JSON.stringify(attachments)]
      );

      await researchQueue.add(
        'research-run',
        {
          runId,
          query: researchQuery,
          supplemental,
          filterTags,
          modelOverrides: normalizedOverrides,
        },
        { jobId: runId }
      );

      res.status(202).json({
        runId,
        status: 'queued',
        supplementalIngest: {
          urlsQueued: ingestSummary.urlsQueued,
          filesQueued: ingestSummary.filesQueued,
          jobIds: ingestSummary.jobIds,
        },
      });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/research/model-options - model allowlists/defaults for per-run selection UI
router.get('/model-options', async (_req, res, next) => {
  try {
    res.json({
      defaults: {
        planner: config.models.planner,
        retriever: config.models.retriever,
        reasoner: config.models.reasoner,
        skeptic: config.models.skeptic,
        synthesizer: config.models.synthesizer,
        verifier: config.models.verifier,
        plain_language_synthesizer: config.models.plainLanguageSynthesizer,
        outline_architect: config.models.outlineArchitect,
        section_drafter: config.models.sectionDrafter,
        internal_challenger: config.models.internalChallenger,
        coherence_refiner: config.models.coherenceRefiner,
        revision_intake: config.models.revisionIntake,
        report_locator: config.models.reportLocator,
        change_planner: config.models.changePlanner,
        section_rewriter: config.models.sectionRewriter,
        citation_integrity_checker: config.models.citationIntegrityChecker,
        final_revision_verifier: config.models.finalRevisionVerifier,
      },
      fallbacks: config.models.fallbacks,
      allowlist: APPROVED_REASONING_MODEL_ALLOWLIST,
    });
  } catch (err) {
    next(err);
  }
});

// GET /api/research - List research runs
router.get('/', async (req, res, next) => {
  try {
    const { status } = req.query as { status?: string };
    let sql = `SELECT id, title, query, supplemental, supplemental_attachments, status, error_message, failed_stage, failure_meta,
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
