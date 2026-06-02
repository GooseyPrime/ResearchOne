import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query, queryOne } from '../../db/pool';
import {
  buildUserOnlyOwnershipSql,
  rejectUnscopedReadOnScopeError,
} from '../../db/tenantScope';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';
import { retentionConfig } from '../../config/retention';
import { writeAuditLog } from '../../services/ingestion/auditLogger';
import { stageFileBuffer } from '../../services/ingestion/uploadStaging';
import { logger } from '../../utils/logger';

const router = Router();

router.use(requireAuth);
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
    ];
    // Use lowercased name so .PDF/.MD etc. are treated the same as .pdf/.md.
    // application/octet-stream is intentionally excluded from the mime list;
    // it is only accepted when the extension itself is on the allow-list.
    const name = file.originalname.toLowerCase();
    const isAllowed = allowed.includes(file.mimetype)
      || name.endsWith('.md')
      || name.endsWith('.txt')
      || name.endsWith('.pdf');
    if (isAllowed) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype} (${file.originalname})`));
    }
  },
});

// POST /api/ingestion/url - Ingest a URL
router.post('/url', async (req, res, next) => {
  try {
    const { url, tags, metadata } = req.body as {
      url: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    };

    if (!url || typeof url !== 'string') {
      res.status(400).json({ error: 'url is required' });
      return;
    }

    const id = uuidv4();
    const ingestionUserId = req.auth?.userId ?? null;
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata, user_id)
         VALUES ($1, $2, 'web_url', 'queued', $3, $4)`,
        [id, url, JSON.stringify(metadata ?? {}), ingestionUserId]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
         VALUES ($1, $2, 'web_url', 'queued', $3)`,
        [id, url, JSON.stringify(metadata ?? {})]
      );
    }

    await ingestionQueue.add('ingest-url', {
      ingestionJobId: id,
      url,
      sourceType: 'web_url',
      tags: tags ?? [],
      metadata: metadata ?? {},
      importedVia: 'manual_url',
    });

    res.status(202).json({ jobId: id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingestion/text - Ingest raw text
router.post('/text', async (req, res, next) => {
  try {
    const { text, title, tags, metadata } = req.body as {
      text: string;
      title?: string;
      tags?: string[];
      metadata?: Record<string, unknown>;
    };

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text is required' });
      return;
    }

    const id = uuidv4();
    const ingestionUserId = req.auth?.userId ?? null;
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata, user_id)
         VALUES ($1, $2, 'text', 'queued', $3, $4)`,
        [id, title ?? 'Imported Text', JSON.stringify(metadata ?? {}), ingestionUserId]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
         VALUES ($1, $2, 'text', 'queued', $3)`,
        [id, title ?? 'Imported Text', JSON.stringify(metadata ?? {})]
      );
    }

    await ingestionQueue.add('ingest-text', {
      ingestionJobId: id,
      text,
      fileName: title ?? 'Imported Text',
      sourceType: 'text',
      tags: tags ?? [],
      metadata: metadata ?? {},
      importedVia: 'manual_upload',
    });

    res.status(202).json({ jobId: id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingestion/file - Ingest a file (PDF, markdown, txt)
router.post('/file', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: 'file is required' });
      return;
    }

    const { tags, metadata } = req.body as { tags?: string; metadata?: string };
    const parsedTags = tags ? (JSON.parse(tags) as string[]) : [];
    const parsedMetadata = metadata ? (JSON.parse(metadata) as Record<string, unknown>) : {};

    const id = uuidv4();
    const mime = req.file.mimetype;
    const filename = req.file.originalname.toLowerCase();

    let sourceType: 'text' | 'pdf' | 'markdown';
    let jobPayload: Record<string, unknown>;

    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      sourceType = 'pdf';
      const staged = stageFileBuffer(req.file.buffer, req.file.originalname);
      jobPayload = {
        stagedFilePath: staged.stagedFilePath,
        stagedFileSha256: staged.stagedFileSha256,
        stagedFileSizeBytes: staged.stagedFileSizeBytes,
      };
    } else if (
      mime === 'text/markdown' ||
      mime === 'text/x-markdown' ||
      filename.endsWith('.md')
    ) {
      sourceType = 'markdown';
      if (req.file.buffer.length > retentionConfig.textQueueInlineMaxBytes) {
        const staged = stageFileBuffer(req.file.buffer, req.file.originalname);
        jobPayload = {
          stagedFilePath: staged.stagedFilePath,
          stagedFileSha256: staged.stagedFileSha256,
          stagedFileSizeBytes: staged.stagedFileSizeBytes,
        };
      } else {
        jobPayload = { text: req.file.buffer.toString('utf8') };
      }
    } else {
      sourceType = 'text';
      if (req.file.buffer.length > retentionConfig.textQueueInlineMaxBytes) {
        const staged = stageFileBuffer(req.file.buffer, req.file.originalname);
        jobPayload = {
          stagedFilePath: staged.stagedFilePath,
          stagedFileSha256: staged.stagedFileSha256,
          stagedFileSizeBytes: staged.stagedFileSizeBytes,
        };
      } else {
        jobPayload = { text: req.file.buffer.toString('utf8') };
      }
    }

    const ingestionUserId = req.auth?.userId ?? null;
    try {
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata, user_id)
         VALUES ($1, $2, $3, 'queued', $4, $5)`,
        [id, req.file.originalname, sourceType, JSON.stringify(parsedMetadata), ingestionUserId]
      );
    } catch (insertErr) {
      if ((insertErr as { code?: string })?.code !== '42703') throw insertErr;
      await query(
        `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
         VALUES ($1, $2, $3, 'queued', $4)`,
        [id, req.file.originalname, sourceType, JSON.stringify(parsedMetadata)]
      );
    }

    await ingestionQueue.add('ingest-file', {
      ingestionJobId: id,
      ...jobPayload,
      fileName: req.file.originalname,
      sourceType,
      originalMimeType: req.file.mimetype,
      tags: parsedTags,
      metadata: parsedMetadata,
      importedVia: 'manual_upload',
    });

    res.status(202).json({ jobId: id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// GET /api/ingestion/jobs - List recent ingestion jobs
router.get('/jobs', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;

    let jobs: unknown[];
    try {
      jobs = await query(
        `SELECT j.id, j.url, j.file_name, j.source_type, j.status, j.error_message,
                j.started_at, j.completed_at, j.created_at, j.source_id, j.metadata,
                s.imported_via, s.discovered_by_run_id
         FROM ingestion_jobs j
         LEFT JOIN sources s ON s.id = j.source_id
         WHERE ${buildUserOnlyOwnershipSql('j', 1)}
         ORDER BY j.created_at DESC
         LIMIT 100`,
        [userId]
      );
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'GET /api/ingestion/jobs');
    }

    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// GET /api/ingestion/jobs/:id - Get a specific ingestion job
router.get('/jobs/:id', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;

    let jobs: unknown[];
    try {
      jobs = await query(
        `SELECT * FROM ingestion_jobs WHERE id=$1 AND ${buildUserOnlyOwnershipSql('', 2)}`,
        [req.params.id, userId]
      );
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'GET /api/ingestion/jobs/:id');
    }

    if (jobs.length === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(jobs[0]);
  } catch (err) {
    next(err);
  }
});

// Pipeline B consent endpoints
router.get('/consent', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    try {
      const row = await queryOne<{ pipeline_b_consent: boolean }>(
        'SELECT pipeline_b_consent FROM user_ingestion_consent WHERE user_id = $1',
        [userId]
      );
      res.json({ consent: row?.pipeline_b_consent ?? true });
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === '42P01') { res.json({ consent: true }); return; }
      throw err;
    }
  } catch (err) { next(err); }
});

router.post('/consent', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) { res.status(401).json({ error: 'Unauthorized' }); return; }
    const rawConsent = req.body?.pipeline_b_consent;
    if (typeof rawConsent !== 'boolean') {
      res.status(400).json({ error: 'pipeline_b_consent must be a boolean' });
      return;
    }
    await query(
      `INSERT INTO user_ingestion_consent (user_id, pipeline_b_consent, consent_updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (user_id) DO UPDATE SET pipeline_b_consent = EXCLUDED.pipeline_b_consent, consent_updated_at = NOW()`,
      [userId, rawConsent]
    );
    await writeAuditLog('system', userId, 'consent_changed', { consent: rawConsent });
    res.json({ consent: rawConsent });
  } catch (err) { next(err); }
});

export default router;
