import path from 'path';
import { Router } from 'express';
import { requireAdmin } from '../../middleware/clerkAuth';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { config } from '../../config';
import { CORPUS_CLEAR_CONFIRM_PHRASE } from '../../constants/corpusAdmin';
import { logger } from '../../utils/logger';
import type { PoolClient } from 'pg';
import { query, adminQuery, withTransaction } from '../../db/pool';
import { writeAdminAction } from '../admin/adminAuditLog';
import { creditWallet, debitWallet } from '../../services/billing/walletService';
import { setUserTier } from '../../services/tier/tierService';
import { isTierName } from '../../config/tierRules';
import {
  getCachedOverrides,
  refreshRuntimeModelOverrides,
  saveRuntimeModelOverrides,
  validateAndNormalizePayload,
} from '../../services/runtimeModelStore';

const router = Router();

router.use(requireAdmin);
const execAsync = promisify(exec);

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(s);
}

const LOG_TAIL_MAX_BYTES = 512 * 1024;
const LOG_TAIL_MAX_LINES = 2000;

function candidateLogPaths(stream: 'out' | 'err'): string[] {
  const fname = stream === 'err' ? 'pm2-error.log' : 'pm2-out.log';
  const explicit = stream === 'err' ? process.env.RUNTIME_LOG_ERR : process.env.RUNTIME_LOG_OUT;
  const cwd = process.cwd();
  const configured = stream === 'err' ? config.admin.runtimeLogErr : config.admin.runtimeLogOut;
  const winstonCombined = path.join(cwd, 'backend', 'logs', 'combined.log');
  const winstonErr = path.join(cwd, 'backend', 'logs', 'error.log');
  const candidates = [
    explicit,
    configured,
    path.join(cwd, 'backend', 'logs', fname),
    path.join(cwd, 'logs', fname),
    path.join('/opt/researchone', 'backend', 'logs', fname),
    path.join('/opt/researchone', 'logs', fname),
    stream === 'out' ? winstonCombined : winstonErr,
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
  logger.info('admin-runtime', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/runtime/logs',
  });

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
        'Set RUNTIME_LOG_OUT and RUNTIME_LOG_ERR on the server to the paths from pm2 describe (out_file / error_file). If PM2 logs are missing, the API also tries Winston files backend/logs/combined.log and backend/logs/error.log (see backend/src/utils/logger.ts).',
    });
    return;
  }
  logger.error('Runtime log read failed', lastErr);
  res.status(500).json({ error: 'Failed to read log file' });
});

router.get('/models', async (req, res) => {
  logger.info('admin-models', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/models',
    verb: 'GET',
  });
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
      fallbacks: config.models.fallbacks,
    },
    overrides: cached.overrides,
    embeddingOverride: cached.embedding ?? null,
  });
});

router.put('/models', async (req, res) => {
  logger.info('admin-models', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/models',
    verb: 'PUT',
  });
  try {
    const payload = validateAndNormalizePayload(req.body);
    await saveRuntimeModelOverrides(payload);
    res.json({ ok: true, overrides: getCachedOverrides().overrides, embeddingOverride: getCachedOverrides().embedding ?? null });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid payload';
    res.status(400).json({ error: msg });
  }
});

/** Remove claims (and cascaded contradictions) tied to these sources, then delete sources. */
async function deleteCorpusSources(client: PoolClient, sourceIds: string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;
  await client.query(
    `DELETE FROM claims
     WHERE source_id = ANY($1::uuid[])
        OR chunk_id IN (SELECT id FROM chunks WHERE source_id = ANY($1::uuid[]))`,
    [sourceIds]
  );
  const del = await client.query(`DELETE FROM sources WHERE id = ANY($1::uuid[])`, [sourceIds]);
  return del.rowCount ?? 0;
}

router.post('/corpus/clear', async (req, res) => {
  logger.info('admin-corpus', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/corpus/clear',
  });
  const confirmPhrase =
    req.body && typeof req.body === 'object' && 'confirmPhrase' in req.body
      ? String((req.body as { confirmPhrase?: string }).confirmPhrase ?? '')
      : '';
  if (confirmPhrase !== CORPUS_CLEAR_CONFIRM_PHRASE) {
    res.status(400).json({
      error: 'Invalid confirmation',
      hint: `confirmPhrase must be exactly: ${CORPUS_CLEAR_CONFIRM_PHRASE}`,
    });
    return;
  }
  try {
    const deleted = await withTransaction(async (client) => {
      const claims = await client.query(`DELETE FROM claims RETURNING id`);
      const sources = await client.query(`DELETE FROM sources RETURNING id`);
      const jobs = await client.query(`DELETE FROM ingestion_jobs RETURNING id`);
      return {
        claims: claims.rowCount ?? 0,
        sources: sources.rowCount ?? 0,
        ingestion_jobs: jobs.rowCount ?? 0,
      };
    });
    logger.warn('Admin corpus clear completed', deleted);
    res.json({ ok: true, deleted });
  } catch (err) {
    logger.error('Admin corpus clear failed', err);
    res.status(500).json({ error: 'Corpus clear failed' });
  }
});

router.post('/corpus/delete-by-ingestion-jobs', async (req, res) => {
  logger.info('admin-corpus', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/corpus/delete-by-ingestion-jobs',
  });
  const raw = req.body && typeof req.body === 'object' && 'jobIds' in req.body
    ? (req.body as { jobIds?: unknown }).jobIds
    : undefined;
  const jobIds = Array.isArray(raw)
    ? [...new Set(raw.map((id) => String(id)).filter(isUuid))]
    : [];
  if (jobIds.length === 0) {
    res.status(400).json({ error: 'jobIds must be a non-empty array of UUIDs' });
    return;
  }
  try {
    const result = await withTransaction(async (client) => {
      const jobRows = await client.query<{ id: string; source_id: string | null }>(
        `SELECT id, source_id FROM ingestion_jobs WHERE id = ANY($1::uuid[])`,
        [jobIds]
      );
      const skippedJobIds = jobRows.rows.filter((jr) => !jr.source_id).map((jr) => jr.id);
      const sourceIds = [
        ...new Set(
          jobRows.rows.map((r) => r.source_id).filter((id): id is string => Boolean(id))
        ),
      ];
      const deletedSourcesCount = await deleteCorpusSources(client, sourceIds);
      return {
        deletedSourceIds: sourceIds,
        deletedSourcesCount,
        skippedJobIds,
      };
    });
    logger.warn('Admin delete-by-ingestion-jobs', { jobIds, ...result });
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Admin delete-by-ingestion-jobs failed', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

router.post('/corpus/delete-by-research-run', async (req, res) => {
  logger.info('admin-corpus', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/corpus/delete-by-research-run',
  });
  const runId =
    req.body && typeof req.body === 'object' && 'runId' in req.body
      ? String((req.body as { runId?: string }).runId ?? '')
      : '';
  if (!isUuid(runId)) {
    res.status(400).json({ error: 'runId must be a valid UUID' });
    return;
  }
  try {
    const result = await withTransaction(async (client) => {
      const src = await client.query<{ id: string }>(
        `SELECT id FROM sources WHERE discovered_by_run_id = $1`,
        [runId]
      );
      const sourceIds = src.rows.map((r) => r.id);
      const deletedSourcesCount = await deleteCorpusSources(client, sourceIds);
      return { runId, deletedSourceIds: sourceIds, deletedSourcesCount };
    });
    logger.warn('Admin delete-by-research-run', result);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error('Admin delete-by-research-run failed', err);
    res.status(500).json({ error: 'Delete failed' });
  }
});

router.post('/runtime/restart', async (req, res) => {
  logger.info('admin-runtime', {
    method: req.adminAuth?.method,
    userId: req.adminAuth?.userId,
    endpoint: '/runtime/restart',
  });

  await query(
    `INSERT INTO error_log (service, error_code, message, context)
     VALUES ($1, $2, $3, $4)`,
    [
      'admin-runtime',
      'restart_requested',
      'Runtime restart requested',
      JSON.stringify({
        ip: req.ip,
        at: new Date().toISOString(),
        adminMethod: req.adminAuth?.method,
        adminUserId: req.adminAuth?.userId,
      }),
    ]
  );

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

// ─── Admin Dashboard: User Lookup ──────────────────────────────────
router.get('/users', async (req, res, next) => {
  try {
    const email = req.query.email as string | undefined;
    const id = req.query.id as string | undefined;

    if (email) {
      const rows = await adminQuery<{ id: string; email: string; first_name: string; last_name: string; created_at: string }>(
        'SELECT id, email, first_name, last_name, created_at FROM users WHERE email ILIKE $1 LIMIT 20',
        [`%${email}%`]
      );
      res.json({ users: rows });
    } else if (id) {
      const rows = await adminQuery<{ id: string; email: string; first_name: string; last_name: string; created_at: string }>(
        'SELECT id, email, first_name, last_name, created_at FROM users WHERE id = $1',
        [id]
      );
      res.json({ users: rows });
    } else {
      res.status(400).json({ error: 'email or id query parameter required' });
    }
  } catch (err) { next(err); }
});

router.get('/users/:id', async (req, res, next) => {
  try {
    const rows = await adminQuery<Record<string, unknown>>(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.created_at,
              t.tier, t.current_period_reports_used, t.lifetime_reports_used,
              w.balance_cents, w.reserved_cents
       FROM users u
       LEFT JOIN user_tiers t ON t.user_id = u.id
       LEFT JOIN user_wallets w ON w.user_id = u.id
       WHERE u.id = $1`,
      [req.params.id]
    );
    if (rows.length === 0) { res.status(404).json({ error: 'User not found' }); return; }
    res.json(rows[0]);
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Wallet Adjustment ───────────────────────────
router.post('/users/:id/wallet-adjust', async (req, res, next) => {
  try {
    const adminId = req.adminAuth?.userId ?? 'unknown';
    const targetUserId = req.params.id;
    const { amountCents, type, reason } = req.body as { amountCents?: number; type?: string; reason?: string };

    if (!amountCents || typeof amountCents !== 'number' || amountCents <= 0) {
      res.status(400).json({ error: 'amountCents must be a positive number' }); return;
    }
    if (!type || (type !== 'credit' && type !== 'debit')) {
      res.status(400).json({ error: 'type must be "credit" or "debit"' }); return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required (min 3 chars)' }); return;
    }

    const fn = type === 'credit' ? creditWallet : debitWallet;
    const result = await fn({
      userId: targetUserId,
      amountCents,
      description: `Admin adjustment: ${reason}`,
      idempotencyKey: `admin_adjust_${targetUserId}_${Date.now()}`,
      metadata: { adminUserId: adminId, reason },
    });

    await writeAdminAction(adminId, targetUserId, `wallet_${type}`, reason, { amountCents, newBalance: result.balanceCents });

    res.json({ applied: result.applied, balanceCents: result.balanceCents });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Tier Override ───────────────────────────────
router.post('/users/:id/tier-override', async (req, res, next) => {
  try {
    const adminId = req.adminAuth?.userId ?? 'unknown';
    const targetUserId = req.params.id;
    const { tier, reason } = req.body as { tier?: string; reason?: string };

    if (!tier || !isTierName(tier)) {
      res.status(400).json({ error: 'tier must be a valid tier name' }); return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required (min 3 chars)' }); return;
    }

    await setUserTier(targetUserId, tier);
    await writeAdminAction(adminId, targetUserId, 'tier_override', reason, { tier });

    res.json({ tier });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Run Telemetry ──────────────────────────────
router.get('/telemetry/runs', async (req, res, next) => {
  try {
    const days = parseInt(req.query.days as string, 10) || 30;
    const since = new Date();
    since.setDate(since.getDate() - days);

    const stats = await adminQuery<Record<string, unknown>>(
      `SELECT
         COUNT(*) as total_runs,
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'failed') as failed,
         COUNT(*) FILTER (WHERE status = 'running') as running,
         research_objective,
         AVG(EXTRACT(EPOCH FROM (completed_at - created_at))) FILTER (WHERE completed_at IS NOT NULL) as avg_runtime_seconds
       FROM research_runs
       WHERE created_at >= $1
       GROUP BY research_objective
       ORDER BY total_runs DESC`,
      [since.toISOString()]
    );

    const daily = await adminQuery<Record<string, unknown>>(
      `SELECT DATE(created_at) as day, COUNT(*) as count, status
       FROM research_runs WHERE created_at >= $1
       GROUP BY DATE(created_at), status ORDER BY day DESC LIMIT 100`,
      [since.toISOString()]
    );

    res.json({ stats, daily, days });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Audit Log ──────────────────────────────────
router.get('/audit-log', async (req, res, next) => {
  try {
    const { user_id, event_type, from, to } = req.query as Record<string, string | undefined>;
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 50, 200);
    const offset = parseInt(req.query.offset as string, 10) || 0;

    let sql = 'SELECT * FROM admin_actions_log WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (user_id) { sql += ` AND (admin_user_id = $${idx} OR target_user_id = $${idx})`; params.push(user_id); idx++; }
    if (event_type) { sql += ` AND action = $${idx}`; params.push(event_type); idx++; }
    if (from) { sql += ` AND created_at >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND created_at <= $${idx}`; params.push(to); idx++; }

    sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    const rows = await adminQuery(sql, params);
    res.json({ entries: rows, limit, offset });
  } catch (err) { next(err); }
});

export default router;
