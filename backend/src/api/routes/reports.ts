import { readFile } from 'fs/promises';
import { Router, RequestHandler } from 'express';
import { requireAdmin, requireAuth } from '../../middleware/clerkAuth';
import multer from 'multer';
import { query, adminQuery } from '../../db/pool';
import { config } from '../../config';
import { publishReportToFeaturedRepo } from '../../services/featuredReportGithub';
import {
  createReportRevision,
  createRevisionRequest,
  getReportRevision,
  listReportRevisions,
} from '../../services/reasoning/reportRevisionService';
import { ingestSupplementalForRevision } from '../../services/research/reportRevisionSupplementalIngest';
import { getSpinoffPrefill } from '../../services/research/spinoffService';
import { logger } from '../../utils/logger';
import { exportReport } from '../../services/formatting/exportOrchestrator';
import {
  pandocAvailable,
  PandocError,
  type ExportFormat,
  type ExportStyle,
} from '../../services/formatting/pandocRunner';
import { reportExportQueue } from '../../queue/queues';
import { resolveLocalExportDiskPath } from '../../services/formatting/exportStorage';

const router = Router();

const allowedSupplementalExtensions = ['.md', '.markdown', '.txt', '.pdf'];
const allowedSupplementalMimeTypes = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/x-markdown',
];

function getLowercaseExtension(filename: string): string {
  const lastDot = filename.lastIndexOf('.');
  return lastDot >= 0 ? filename.slice(lastDot).toLowerCase() : '';
}

function isAllowedSupplementalUpload(file: { mimetype: string; originalname: string }): boolean {
  const extension = getLowercaseExtension(file.originalname);
  const hasAllowedExtension = allowedSupplementalExtensions.includes(extension);

  if (allowedSupplementalMimeTypes.includes(file.mimetype)) return true;
  if (file.mimetype === 'application/octet-stream') return hasAllowedExtension;

  return hasAllowedExtension;
}

function wrapMulterMiddleware(middleware: RequestHandler): RequestHandler {
  return (req, res, next) => {
    middleware(req, res, (err?: unknown) => {
      if (!err) {
        next();
        return;
      }

      if (err instanceof Error) {
        res.status(400).json({ error: err.message });
        return;
      }

      next(err instanceof Error ? err : new Error(String(err)));
    });
  };
}

// Multer config for the revision-request endpoint. Mirrors the multer
// config in /api/research POST so the file allow-list and size limits
// stay consistent across both supplemental-attachment surfaces.
const uploadRevisionMulter = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024, files: 25 },
  fileFilter: (_req, file, cb) => {
    if (isAllowedSupplementalUpload(file)) {
      cb(null, true);
      return;
    }

    cb(new Error(`Unsupported supplemental file type: ${file.mimetype} (${file.originalname})`));
  },
});

const uploadRevision = {
  single: (fieldName: string) => wrapMulterMiddleware(uploadRevisionMulter.single(fieldName)),
  array: (fieldName: string, maxCount?: number) =>
    wrapMulterMiddleware(uploadRevisionMulter.array(fieldName, maxCount)),
  fields: (fields: readonly { name: string; maxCount?: number }[]) =>
    wrapMulterMiddleware(uploadRevisionMulter.fields(fields)),
  any: () => wrapMulterMiddleware(uploadRevisionMulter.any()),
  none: () => wrapMulterMiddleware(uploadRevisionMulter.none()),
};

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

function reportToMarkdown(args: {
  title: string;
  query: string;
  sections: Array<{ title: string; content: string }>;
}): string {
  const lines: string[] = [
    `# ${args.title}`,
    '',
    `**Research query:** ${args.query}`,
    '',
  ];
  for (const s of args.sections) {
    lines.push(`## ${s.title}`, '', s.content, '', '');
  }
  return lines.join('\n').trim() + '\n';
}

// POST /api/reports/:id/publish-featured — admin-only; mounted before requireAuth so
// break-glass ADMIN_RUNTIME_TOKEN works without a Clerk session.
router.post('/:id/publish-featured', requireAdmin, async (req, res, next) => {
  try {
    const rows = await query<{
      id: string;
      title: string;
      query: string;
    }>(`SELECT id, title, query FROM reports WHERE id=$1`, [req.params.id]);

    if (rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const report = rows[0];
    const sections = await query<{ title: string; content: string }>(
      `SELECT title, content FROM report_sections WHERE report_id=$1 ORDER BY section_order`,
      [req.params.id]
    );

    const markdown = reportToMarkdown({
      title: report.title,
      query: report.query,
      sections,
    });

    const pathInRepo = config.featuredReportGithub.path;
    const branch = config.featuredReportGithub.branch;
    const commitMessage = `feat(featured): ResearchOne report — ${report.title.slice(0, 80)}`;

    const result = await publishReportToFeaturedRepo({
      pathInRepo,
      branch,
      markdown,
      commitMessage,
    });

    res.json({
      ok: true,
      repo: `${config.featuredReportGithub.owner}/${config.featuredReportGithub.repo}`,
      path: pathInRepo,
      branch,
      commitUrl: result.commitUrl ?? null,
    });
  } catch (err) {
    next(err);
  }
});

router.use(requireAuth);

/**
 * GET /api/reports/exports/engine-status
 *
 * Lightweight Pandoc availability probe for the export UI (Rule 28 I-6).
 * Registered before `/exports/:exportId` so `engine-status` is not parsed
 * as a UUID.
 */
router.get('/exports/engine-status', async (_req, res, next) => {
  try {
    const avail = await pandocAvailable();
    res.json({ available: avail.available, version: avail.version });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/exports/:exportId/download
 *
 * Auth-gated binary download for completed local exports (PR #115).
 * Must be registered before `/exports/:exportId` (poll JSON).
 */
router.get('/exports/:exportId/download', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.auth?.orgId ?? null;
    const exportId = req.params.exportId;

    type PickRow = { format: string; status: string; style: string };
    let rows: PickRow[];
    try {
      rows = await adminQuery<PickRow>(
        `SELECT e.format, e.status, e.style
           FROM report_exports e
           JOIN reports r ON r.id = e.report_id
          WHERE e.id = $1
            AND e.user_id = $2
            AND (r.user_id = $2 OR (r.org_id IS NOT NULL AND r.org_id = $3) OR r.user_id IS NULL)
          LIMIT 1`,
        [exportId, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/exports/:exportId/download' });
      rows = await adminQuery<PickRow>(
        `SELECT e.format, e.status, e.style
           FROM report_exports e
          WHERE e.id = $1 AND e.user_id = $2
          LIMIT 1`,
        [exportId, userId]
      );
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'export not found' });
      return;
    }
    if (rows[0].status !== 'completed') {
      res.status(409).json({
        error: 'export_not_ready',
        detail: `Export status is "${rows[0].status}".`,
      });
      return;
    }

    const format = rows[0].format as ExportFormat;
    const diskPath = resolveLocalExportDiskPath(exportId, format);
    let buf: Buffer;
    try {
      buf = await readFile(diskPath);
    } catch {
      res.status(404).json({ error: 'export file missing' });
      return;
    }

    res.setHeader('Content-Type', mimeForExportFormat(format));
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="report-export-${exportId.slice(0, 8)}-${rows[0].style}.${format}"`
    );
    res.send(buf);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/reports/exports/:exportId
 *
 * Polling endpoint for async exports. Must be registered before
 * `router.get('/:id', …)` so `exports` is not captured as a report id.
 */
router.get('/exports/:exportId', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = req.auth?.orgId ?? null;
    let rows: Array<{
      id: string;
      status: string;
      format: string;
      style: string;
      output_url: string | null;
      output_bytes: number | null;
      error_class: string | null;
      error_detail: string | null;
      created_at: string;
      completed_at: string | null;
    }>;
    try {
      rows = await adminQuery(
        `SELECT e.id, e.status, e.format, e.style, e.output_url, e.output_bytes,
                e.error_class, e.error_detail, e.created_at, e.completed_at
           FROM report_exports e
           JOIN reports r ON r.id = e.report_id
          WHERE e.id = $1
            AND e.user_id = $2
            AND (r.user_id = $2 OR (r.org_id IS NOT NULL AND r.org_id = $3) OR r.user_id IS NULL)
          LIMIT 1`,
        [req.params.exportId, userId, orgId]
      );
    } catch (dbErr) {
      if ((dbErr as { code?: string }).code === '42P01') {
        res.status(503).json({
          error: 'export service unavailable',
          detail: 'Database migration pending.',
        });
        return;
      }
      if ((dbErr as { code?: string }).code === '42703') {
        logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/exports/:exportId' });
        rows = await adminQuery(
          `SELECT id, status, format, style, output_url, output_bytes,
                  error_class, error_detail, created_at, completed_at
             FROM report_exports
            WHERE id = $1 AND user_id = $2
            LIMIT 1`,
          [req.params.exportId, userId]
        );
      } else {
        throw dbErr;
      }
    }
    if (rows.length === 0) {
      res.status(404).json({ error: 'export not found' });
      return;
    }
    res.json(rows[0]);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports - List reports
router.get('/', async (req, res, next) => {
  try {
    const { status, search } = req.query as { status?: string; search?: string };
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    const baseCols = `r.id, r.title, r.query, r.status, r.executive_summary,
              r.source_count, r.chunk_count, r.contradiction_count,
              r.finalized_at, r.created_at, r.version_number,
              r.root_report_id, r.parent_report_id`;

    const scopeCols = `, r.user_id AS owner_user_id, r.org_id`;

    const retentionCols = `, r.report_expires_at, r.workspace_expires_at, r.workspace_purged_at, r.retention_status`;

    const livingSubquery = `, EXISTS(SELECT 1 FROM report_monitors rm WHERE rm.report_id = r.id AND rm.monitor_kind = 'living_report' AND rm.status = 'active') AS has_active_living_report`;

    function buildWhere(params: unknown[], includeRetentionFilter: boolean, scoped: boolean): string {
      let where = ' WHERE 1=1';
      if (scoped) {
        params.push(userId, orgId);
        where += ` AND (r.user_id = $${params.length - 1} OR (r.org_id IS NOT NULL AND r.org_id = $${params.length}) OR r.user_id IS NULL)`;
      }
      if (includeRetentionFilter) {
        where += ` AND (r.retention_status IS NULL OR r.retention_status NOT IN ('expired', 'deleted'))`;
      }
      if (status) {
        params.push(status);
        where += ` AND r.status=$${params.length}`;
      }
      if (search) {
        params.push(search);
        where += ` AND to_tsvector('english', coalesce(r.title,'') || ' ' || coalesce(r.executive_summary,'')) @@ plainto_tsquery('english', $${params.length})`;
      }
      return where;
    }

    let rows: unknown[];
    try {
      const params: unknown[] = [];
      const sql = `SELECT ${baseCols}${scopeCols}${retentionCols}${livingSubquery} FROM reports r${buildWhere(params, true, true)} ORDER BY r.created_at DESC LIMIT 100`;
      rows = await query(sql, params);
    } catch (err: unknown) {
      const pgCode = (err as { code?: string }).code;
      if (pgCode === '42703') {
        logger.warn('legacy_unscoped_read', { route: 'GET /api/reports' });
        try {
          const params: unknown[] = [];
          const sql = `SELECT ${baseCols}${livingSubquery} FROM reports r${buildWhere(params, false, false)} ORDER BY r.created_at DESC LIMIT 100`;
          const fallbackRows = await query(sql, params);
          rows = (fallbackRows as Array<Record<string, unknown>>).map((r) => ({
            ...r,
            owner_user_id: null,
            org_id: null,
            report_expires_at: null,
            workspace_expires_at: null,
            workspace_purged_at: null,
            retention_status: null,
          }));
        } catch (fallbackErr: unknown) {
          const fbCode = (fallbackErr as { code?: string }).code;
          if (fbCode !== '42703') throw fallbackErr;
          const params: unknown[] = [];
          const sql = `SELECT ${baseCols} FROM reports r${buildWhere(params, false, false)} ORDER BY r.created_at DESC LIMIT 100`;
          const fallbackRows = await query(sql, params);
          rows = (fallbackRows as Array<Record<string, unknown>>).map((r) => ({
            ...r,
            owner_user_id: null,
            org_id: null,
            report_expires_at: null,
            workspace_expires_at: null,
            workspace_purged_at: null,
            retention_status: null,
          }));
        }
      } else {
        throw err;
      }
    }

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/spinoff/prefill — form defaults for research spinoff (before /:id)
router.get('/:id/spinoff/prefill', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;
    const prefill = await getSpinoffPrefill(req.params.id, { userId, orgId });
    if (!prefill) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    res.json(prefill);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id - Get full report with sections
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let rows: unknown[];
    try {
      rows = await query(
        `SELECT * FROM reports WHERE id=$1 AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3) OR user_id IS NULL)`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/:id' });
      rows = await query(
        `SELECT * FROM reports WHERE id=$1`,
        [req.params.id]
      );
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const sections = await query(
      `SELECT * FROM report_sections WHERE report_id=$1 ORDER BY section_order`,
      [req.params.id]
    );

    let hasActiveLivingReport = false;
    try {
      const lrRows = await query(
        `SELECT 1 FROM report_monitors WHERE report_id = $1 AND monitor_kind = 'living_report' AND status = 'active' LIMIT 1`,
        [req.params.id],
      );
      hasActiveLivingReport = lrRows.length > 0;
    } catch {
      // best-effort; report_monitors may not exist yet
    }

    res.json({ ...(rows[0] as Record<string, unknown>), sections, has_active_living_report: hasActiveLivingReport });
  } catch (err) {
    next(err);
  }
});

// POST /api/reports/:id/revisions - Request and apply a report revision.
// Accepts JSON or multipart/form-data. The multipart variant lets the user
// attach supplemental files (PDF/TXT/MD) and URLs alongside their request
// text. Attachments are queued onto the same corpus-ingestion pipeline
// used by manual uploads (so they persist as retrievable evidence) AND
// their extracted text is spliced into the revision prompts so the
// current revision call can use them as evidence directly.
router.post(
  '/:id/revisions',
  (req, res, next) => {
    const ct = req.headers['content-type'] || '';
    if (ct.includes('multipart/form-data')) {
      uploadRevision.array('files', 25)(req, res, next);
    } else {
      next();
    }
  },
  async (req, res, next) => {
    try {
      const isMultipart = Boolean(req.headers['content-type']?.includes('multipart/form-data'));
      const body = req.body as Record<string, unknown>;

      const requestText = typeof body.requestText === 'string' ? body.requestText : '';
      const rationale = typeof body.rationale === 'string' ? body.rationale : undefined;
      const initiatedBy = typeof body.initiatedBy === 'string' ? body.initiatedBy : undefined;
      const initiatedByType = typeof body.initiatedByType === 'string' ? body.initiatedByType : undefined;

      let revisionUrls: string[] = [];
      if (isMultipart) {
        const rawSu = body.revisionUrls as unknown;
        const parsed =
          typeof rawSu === 'string' ? parseJsonField<unknown[]>(rawSu, []) : Array.isArray(rawSu) ? rawSu : [];
        revisionUrls = Array.isArray(parsed) ? parsed.map((u) => String(u).trim()).filter(Boolean) : [];
      } else {
        const jsonBody = req.body as { revisionUrls?: string[] };
        revisionUrls = Array.isArray(jsonBody.revisionUrls)
          ? jsonBody.revisionUrls.map((u) => String(u).trim()).filter(Boolean)
          : [];
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (!requestText || typeof requestText !== 'string') {
        res.status(400).json({ error: 'requestText is required' });
        return;
      }

      const io = req.app.get('io') as { to: (room: string) => { emit: (event: string, data: unknown) => void } } | undefined;
      // Revision workspace uses `subscribe:revision` → `job:revision:*` only.
      // Also emit to `job:${id}` for clients on `subscribe:job` (e.g. living-report path).
      const emitProgress = (payload: unknown) => {
        io?.to(`job:revision:${req.params.id}`).emit('revision:progress', payload);
        io?.to(`job:${req.params.id}`).emit('revision:progress', payload);
        io?.to('reports').emit('revision:progress', payload);
      };

      // Create the request row first so the real DB id is available when
      // ingesting supplemental files. This ensures ingestion_jobs rows are
      // tagged with the correct revision_request_id from the start rather
      // than a synthetic pending-... placeholder.
      const { requestId } = await createRevisionRequest({
        reportId: req.params.id,
        requestText,
        rationale,
        initiatedBy,
        initiatedByType,
      });

      let supplementalContext = '';
      let supplementalAttachments: Array<Record<string, unknown>> = [];
      if (files.length > 0 || revisionUrls.length > 0) {
        emitProgress({ reportId: req.params.id, stage: 'attachments', percent: 2, message: 'Ingesting supplemental attachments...', timestamp: new Date().toISOString() });
        const ingest = await ingestSupplementalForRevision({
          reportId: req.params.id,
          revisionRequestId: requestId,
          urls: revisionUrls,
          files: files.map((f) => ({
            originalname: f.originalname,
            mimetype: f.mimetype,
            buffer: f.buffer,
          })),
          userId: req.auth?.userId ?? undefined,
        });
        supplementalContext = ingest.inlineContext;
        supplementalAttachments = ingest.attachments as Array<Record<string, unknown>>;
      }

      const result = await createReportRevision({
        reportId: req.params.id,
        requestId,
        requestText,
        rationale,
        initiatedBy,
        initiatedByType,
        supplementalContext: supplementalContext || undefined,
        supplementalAttachments,
        onProgress: emitProgress,
      });

      const responsePayload = { ...result, supplementalAttachments };
      io?.to(`job:revision:${req.params.id}`).emit('revision:completed', responsePayload);
      io?.to(`job:${req.params.id}`).emit('revision:completed', responsePayload); // see emitProgress — do not join both rooms in one client
      io?.to('reports').emit('reports:updated', {});
      res.status(202).json(responsePayload);
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/reports/:id/revisions - list revision history
router.get('/:id/revisions', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let ownerRows: unknown[];
    try {
      ownerRows = await query(
        `SELECT id FROM reports WHERE id=$1 AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3) OR user_id IS NULL)`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/:id/revisions' });
      ownerRows = await query(`SELECT id FROM reports WHERE id=$1`, [req.params.id]);
    }

    if (ownerRows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

    const revisions = await listReportRevisions(req.params.id);
    res.json(revisions);
  } catch (err) {
    next(err);
  }
});

// GET /api/reports/:id/revisions/:revisionId - revision detail
router.get('/:id/revisions/:revisionId', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let ownerRows: unknown[];
    try {
      ownerRows = await query(
        `SELECT id FROM reports WHERE id=$1 AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3) OR user_id IS NULL)`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/:id/revisions/:revisionId' });
      ownerRows = await query(`SELECT id FROM reports WHERE id=$1`, [req.params.id]);
    }

    if (ownerRows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }

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
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let citations: unknown[];
    try {
      citations = await query(
        `SELECT rc.*, s.url AS source_url, s.title AS source_title
         FROM report_citations rc
         LEFT JOIN sources s ON s.id = rc.source_id
         JOIN reports rp ON rp.id = rc.report_id
         WHERE rc.report_id=$1 AND (rp.user_id = $2 OR (rp.org_id IS NOT NULL AND rp.org_id = $3) OR rp.user_id IS NULL)`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'GET /api/reports/:id/citations' });
      citations = await query(
        `SELECT rc.*, s.url AS source_url, s.title AS source_title
         FROM report_citations rc
         LEFT JOIN sources s ON s.id = rc.source_id
         WHERE rc.report_id=$1`,
        [req.params.id]
      );
    }

    res.json(citations);
  } catch (err) {
    next(err);
  }
});

const VALID_EXPORT_FORMATS: ReadonlySet<ExportFormat> = new Set(['docx', 'pdf', 'md', 'html']);
const VALID_EXPORT_STYLES: ReadonlySet<ExportStyle> = new Set([
  'mla',
  'apa',
  'chicago-author-date',
  'chicago-note',
  'ieee',
  'harvard',
]);

/**
 * POST /api/reports/:id/export
 *
 * Body: { format, style, sync?: boolean }
 *
 * Rule 28 I-6: when Pandoc is missing, returns 200 JSON
 * `{ available: false, reason: 'pandoc_not_installed' }` (never 500).
 */
router.post('/:id/export', async (req, res, next) => {
  try {
    const reportId = req.params.id;
    const body = req.body as Record<string, unknown>;
    const format = String(body.format ?? '').toLowerCase() as ExportFormat;
    const style = String(body.style ?? '').toLowerCase() as ExportStyle;
    const sync = body.sync === true;

    if (!VALID_EXPORT_FORMATS.has(format)) {
      res.status(400).json({
        error: 'invalid format',
        validFormats: Array.from(VALID_EXPORT_FORMATS),
      });
      return;
    }
    if (!VALID_EXPORT_STYLES.has(style)) {
      res.status(400).json({
        error: 'invalid style',
        validStyles: Array.from(VALID_EXPORT_STYLES),
      });
      return;
    }

    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let owned: { id: string }[];
    try {
      owned = await query(
        `SELECT id FROM reports WHERE id=$1 AND (user_id=$2 OR (org_id IS NOT NULL AND org_id=$3) OR user_id IS NULL)`,
        [reportId, userId, orgId]
      );
    } catch (scopeErr) {
      if ((scopeErr as { code?: string })?.code !== '42703') throw scopeErr;
      logger.warn('legacy_unscoped_read', { route: 'POST /api/reports/:id/export' });
      owned = await query(`SELECT id FROM reports WHERE id=$1`, [reportId]);
    }
    if (owned.length === 0) {
      res.status(404).json({ error: 'report not found' });
      return;
    }

    const avail = await pandocAvailable();
    if (!avail.available) {
      res.json({
        available: false,
        reason: 'pandoc_not_installed',
        detail: 'Pandoc is not installed on this server. Contact your administrator.',
      });
      return;
    }

    if (sync) {
      try {
        const result = await exportReport({
          reportId,
          format,
          style,
          userId,
        });
        const mime = mimeForExportFormat(format);
        res.setHeader('Content-Type', mime);
        res.setHeader(
          'Content-Disposition',
          `attachment; filename="report-${reportId.slice(0, 8)}-${style}.${format}"`
        );
        res.send(result.outputBuffer);
        return;
      } catch (err) {
        if (err instanceof PandocError) {
          res.status(err.classification === 'timeout' ? 504 : 422).json({
            error: err.classification,
            detail: err.message,
          });
          return;
        }
        throw err;
      }
    }

    let exportRows: { id: string }[];
    try {
      exportRows = await adminQuery<{ id: string }>(
        `INSERT INTO report_exports (report_id, user_id, format, style, status)
         VALUES ($1, $2, $3, $4, 'queued')
         RETURNING id`,
        [reportId, userId, format, style]
      );
    } catch (dbErr) {
      if ((dbErr as { code?: string }).code === '42P01') {
        res.status(503).json({
          error: 'export service unavailable',
          detail: 'Database migration pending.',
        });
        return;
      }
      throw dbErr;
    }
    const exportId = exportRows[0].id;

    await reportExportQueue.add(
      'export',
      { exportId, reportId, format, style, userId },
      {
        attempts: 2,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: { age: 3600 },
        removeOnFail: { age: 86400 },
      }
    );

    res.status(202).json({
      exportId,
      status: 'queued',
      pollUrl: `/api/reports/exports/${exportId}`,
    });
  } catch (err) {
    next(err);
  }
});

function mimeForExportFormat(format: ExportFormat): string {
  switch (format) {
    case 'docx':
      return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    case 'pdf':
      return 'application/pdf';
    case 'md':
      return 'text/markdown; charset=utf-8';
    case 'html':
      return 'text/html; charset=utf-8';
  }
}

export default router;
