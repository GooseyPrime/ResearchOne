import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import { ingestionQueue } from '../../queue/queues';
import { config } from '../../config';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
      'application/octet-stream', // fallback for .md files uploaded without MIME detection
    ];
    const isAllowed = allowed.includes(file.mimetype)
      || file.originalname.endsWith('.md')
      || file.originalname.endsWith('.txt')
      || file.originalname.endsWith('.pdf');
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
    await query(
      `INSERT INTO ingestion_jobs (id, url, source_type, status, metadata)
       VALUES ($1, $2, 'web_url', 'queued', $3)`,
      [id, url, JSON.stringify(metadata ?? {})]
    );

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
    await query(
      `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
       VALUES ($1, $2, 'text', 'queued', $3)`,
      [id, title ?? 'Imported Text', JSON.stringify(metadata ?? {})]
    );

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
    let fileData: { text?: string; fileBuffer?: string };

    if (mime === 'application/pdf' || filename.endsWith('.pdf')) {
      sourceType = 'pdf';
      fileData = { fileBuffer: req.file.buffer.toString('base64') };
    } else if (
      mime === 'text/markdown' ||
      mime === 'text/x-markdown' ||
      filename.endsWith('.md')
    ) {
      sourceType = 'markdown';
      fileData = { text: req.file.buffer.toString('utf8') };
    } else {
      // plain text
      sourceType = 'text';
      fileData = { text: req.file.buffer.toString('utf8') };
    }

    await query(
      `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
       VALUES ($1, $2, $3, 'queued', $4)`,
      [id, req.file.originalname, sourceType, JSON.stringify(parsedMetadata)]
    );

    await ingestionQueue.add('ingest-file', {
      ingestionJobId: id,
      ...fileData,
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
router.get('/jobs', async (_req, res, next) => {
  try {
    const jobs = await query(
      `SELECT j.id, j.url, j.file_name, j.source_type, j.status, j.error_message,
              j.started_at, j.completed_at, j.created_at, j.source_id, j.metadata,
              s.imported_via, s.discovered_by_run_id
       FROM ingestion_jobs j
       LEFT JOIN sources s ON s.id = j.source_id
       ORDER BY j.created_at DESC
       LIMIT 100`
    );
    res.json(jobs);
  } catch (err) {
    next(err);
  }
});

// GET /api/ingestion/jobs/:id - Get a specific ingestion job
router.get('/jobs/:id', async (req, res, next) => {
  try {
    const jobs = await query(
      `SELECT * FROM ingestion_jobs WHERE id=$1`,
      [req.params.id]
    );
    if (jobs.length === 0) {
      res.status(404).json({ error: 'Job not found' });
      return;
    }
    res.json(jobs[0]);
  } catch (err) {
    next(err);
  }
});

export default router;
