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
    });

    res.status(202).json({ jobId: id, status: 'queued' });
  } catch (err) {
    next(err);
  }
});

// POST /api/ingestion/file - Ingest a file (PDF, text)
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
    const isTxt = req.file.mimetype === 'text/plain';
    const sourceType = isTxt ? 'text' : 'pdf';
    const text = isTxt ? req.file.buffer.toString('utf8') : req.file.buffer.toString('base64');

    await query(
      `INSERT INTO ingestion_jobs (id, file_name, source_type, status, metadata)
       VALUES ($1, $2, $3, 'queued', $4)`,
      [id, req.file.originalname, sourceType, JSON.stringify(parsedMetadata)]
    );

    await ingestionQueue.add('ingest-file', {
      ingestionJobId: id,
      text: isTxt ? text : undefined,
      fileBuffer: isTxt ? undefined : text,
      fileName: req.file.originalname,
      sourceType,
      tags: parsedTags,
      metadata: parsedMetadata,
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
      `SELECT id, url, file_name, source_type, status, error_message, started_at, completed_at, created_at
       FROM ingestion_jobs
       ORDER BY created_at DESC
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
