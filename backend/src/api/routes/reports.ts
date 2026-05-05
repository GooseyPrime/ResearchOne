import { Router, RequestHandler } from 'express';
import multer from 'multer';
import { query } from '../../db/pool';
import { config } from '../../config';
import { publishReportToFeaturedRepo } from '../../services/featuredReportGithub';
import {
  createReportRevision,
  createRevisionRequest,
  getReportRevision,
  listReportRevisions,
} from '../../services/reasoning/reportRevisionService';
import { ingestSupplementalForRevision } from '../../services/research/reportRevisionSupplementalIngest';

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

function publishTokenOk(req: { header: (name: string) => string | undefined }): boolean {
  const h = req.header('authorization') || req.header('x-admin-token') || '';
  const token = h.startsWith('Bearer ') ? h.slice('Bearer '.length).trim() : h.trim();
  return Boolean(config.admin.token) && token === config.admin.token;
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

      io?.to(`job:revision:${req.params.id}`).emit('revision:completed', result);
      io?.to('reports').emit('reports:updated', {});
      res.status(202).json(result);
    } catch (err) {
      next(err);
    }
  }
);


// POST /api/reports/:id/publish-featured — push full report markdown to GitHub for thenewontology.life
router.post('/:id/publish-featured', async (req, res, next) => {
  try {
    if (!publishTokenOk(req)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

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
