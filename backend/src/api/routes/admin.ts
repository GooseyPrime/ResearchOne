import path from 'path';
import { Router } from 'express';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { query } from '../../db/pool';
import {
  getCachedOverrides,
  refreshRuntimeModelOverrides,
  saveRuntimeModelOverrides,
  validateAndNormalizePayload,
} from '../../services/runtimeModelStore';

const router = Router();
const execAsync = promisify(exec);

const LOG_TAIL_MAX_BYTES = 512 * 1024;
const LOG_TAIL_MAX_LINES = 2000;

function getProvidedToken(header?: string): string {
  if (!header) return '';
  if (header.startsWith('Bearer ')) return header.slice('Bearer '.length).trim();
  return header.trim();
}

function adminTokenOk(req: { header: (name: string) => string | undefined }): boolean {
  const token = getProvidedToken(req.header('authorization') || req.header('x-admin-token'));
  return Boolean(config.admin.token) && token === config.admin.token;
}

function candidateLogPaths(stream: 'out' | 'err'): string[] {
  const fname = stream === 'err' ? 'pm2-error.log' : 'pm2-out.log';
  const explicit = stream === 'err' ? process.env.RUNTIME_LOG_ERR : process.env.RUNTIME_LOG_OUT;
  const cwd = process.cwd();
  const candidates = [
    explicit,
    path.join(cwd, 'backend', 'logs', fname),
    path.join(cwd, 'logs', fname),
    path.join('/opt/researchone', 'backend', 'logs', fname),
  ].filter((p): p is string => Boolean(p && p.trim()));
  return [...new Set(candidates)];
}

async function readLogTail(filePath: string, lineCount: number): Promise<{ content: string; truncated: boolean }> {
  const stat = await fs.stat(filePath);
  const start = stat.size > LOG_TAIL_MAX_BYTES ? stat.size - LOG_TAIL_MAX_BYTES : 0;
  const fh = await fs.open(filePath, 'r');
  try {
    const byteLen = stat.size - start;
    const buf = Buffer.alloc(byteLen);
    await fh.read(buf, 0, byteLen, start);
    let text = buf.toString('utf8');
    const truncated = start > 0;
    if (start > 0) {
      const firstNl = text.indexOf('\n');
      if (firstNl !== -1) text = text.slice(firstNl + 1);
    }
    const parts = text.split('\n');
    const tail = parts.slice(-lineCount).join('\n');
    return { content: tail, truncated };
  } finally {
    await fh.close();
  }
}

router.get('/runtime/logs', async (req, res) => {
  if (!adminTokenOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const stream = (req.query.stream as string) === 'err' ? 'err' : 'out';
  const rawLines = parseInt(String(req.query.lines || '500'), 10);
  const lines = Number.isFinite(rawLines)
    ? Math.min(Math.max(rawLines, 1), LOG_TAIL_MAX_LINES)
    : 500;
  const triedPaths = candidateLogPaths(stream);
  let lastErr: unknown;
  for (const filePath of triedPaths) {
    try {
      const { content, truncated } = await readLogTail(filePath, lines);
      res.json({ stream, lines, content, truncated, resolvedPath: filePath });
      return;
    } catch (err) {
      lastErr = err;
      const code = err && typeof err === 'object' && 'code' in err ? (err as NodeJS.ErrnoException).code : '';
      if (code !== 'ENOENT') {
        logger.error('Runtime log read failed', err);
        res.status(500).json({ error: 'Failed to read log file' });
        return;
      }
    }
  }
  const code = lastErr && typeof lastErr === 'object' && 'code' in lastErr ? (lastErr as NodeJS.ErrnoException).code : '';
  if (code === 'ENOENT') {
    res.status(404).json({
      error: 'Log file not found',
      stream,
      triedPaths,
      hint:
        'Set RUNTIME_LOG_OUT and RUNTIME_LOG_ERR on the server to the paths from pm2 describe (out_file / error_file), or ensure PM2 has created the log files under backend/logs.',
    });
    return;
  }
  logger.error('Runtime log read failed', lastErr);
  res.status(500).json({ error: 'Failed to read log file' });
});

router.get('/models', async (req, res) => {
  if (!adminTokenOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    await refreshRuntimeModelOverrides();
  } catch (err) {
    logger.warn('Could not refresh model overrides from DB', err);
  }
  const cached = getCachedOverrides();
  res.json({
    defaults: {
      embedding: config.models.embedding,
      planner: config.models.planner,
      retriever: config.models.retriever,
      reasoner: config.models.reasoner,
      skeptic: config.models.skeptic,
      synthesizer: config.models.synthesizer,
      verifier: config.models.verifier,
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
      fallbacks: config.models.fallbacks,
    },
    overrides: cached.overrides,
    embeddingOverride: cached.embedding ?? null,
  });
});

router.put('/models', async (req, res) => {
  if (!adminTokenOk(req)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  try {
    const payload = validateAndNormalizePayload(req.body);
    await saveRuntimeModelOverrides(payload);
    res.json({ ok: true, overrides: getCachedOverrides().overrides, embeddingOverride: getCachedOverrides().embedding ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid payload';
    res.status(400).json({ error: msg });
  }
});

router.post('/runtime/restart', async (req, res) => {
  const ok = adminTokenOk(req);

  await query(
    `INSERT INTO error_log (service, error_code, message, context)
     VALUES ($1, $2, $3, $4)`,
    [
      'admin-runtime',
      ok ? 'restart_requested' : 'restart_denied',
      ok ? 'Runtime restart requested by authenticated admin token' : 'Unauthorized runtime restart attempt',
      JSON.stringify({ ip: req.ip, at: new Date().toISOString() }),
    ]
  );

  if (!ok) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  const command = config.admin.restartCommand;
  logger.warn(`Admin runtime restart initiated: ${command}`);

  try {
    await execAsync(command, { timeout: 30000 });
    res.json({ ok: true, status: 'restart_triggered' });
  } catch (err) {
    logger.error('Restart command failed', err);
    res.status(500).json({ ok: false, error: 'Restart command failed' });
  }
});

export default router;
