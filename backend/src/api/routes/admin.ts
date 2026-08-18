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
import { isTierName } from '../../config/tierRules';
import {
  getCachedOverrides,
  refreshRuntimeModelOverrides,
  saveRuntimeModelOverrides,
  validateAndNormalizePayload,
} from '../../services/runtimeModelStore';
import {
  getAdminOverviewMetrics,
  getVendorBalances,
  listAdminCorpusSources,
  listAdminReports,
} from '../../services/admin/adminOpsReadService';
import { parseRunReference } from '../../services/research/runReference';

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
      sourceClassClassifier: config.models.sourceClassClassifier,
      reasoner: config.models.reasoner,
      steelman: config.models.steelman,
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

// ─── Admin Dashboard: Run Reference Lookup ────────────────────────
// Support-facing: a user quotes "R1-20260818-0042-7K3M9-4" and this resolves it
// to the run. Deliberately covers FAILED runs — those are the ones people write
// in about — so it queries research_runs, not reports.
//
// adminQuery bypasses RLS: an admin must be able to look up any tenant's run.
router.get('/runs/lookup', async (req, res, next) => {
  try {
    const parsed = parseRunReference(req.query.ref as string | undefined);
    if (!parsed.ok) {
      // Distinguish "you mistyped it" from "no such run": a failed check
      // character is actionable feedback, a missing row is not.
      const message =
        parsed.reason === 'empty'
          ? 'ref query parameter required'
          : parsed.reason === 'check_failed'
            ? 'Reference failed its check character — it was likely mistyped or truncated.'
            : 'Reference is not in the expected format (R1-YYYYMMDD-HHMM-XXXXX-C).';
      res.status(400).json({ error: message, reason: parsed.reason });
      return;
    }

    logger.info('admin-run-lookup', {
      method: req.adminAuth?.method,
      ref: parsed.ref,
    });

    const rows = await adminQuery<Record<string, unknown>>(
      `SELECT r.id, r.run_ref, r.title, r.status, r.created_at, r.updated_at,
              r.user_id, r.org_id, r.engine_version, r.research_objective,
              r.failure_reason, r.spinoff_from_run_id,
              u.email AS user_email,
              rep.id AS report_id, rep.status AS report_status
         FROM research_runs r
         LEFT JOIN users u ON u.id = r.user_id
         LEFT JOIN reports rep ON rep.run_id = r.id
        WHERE r.run_ref = $1
        LIMIT 1`,
      [parsed.ref]
    );

    if (rows.length === 0) {
      res.status(404).json({ error: 'No run found for that reference', ref: parsed.ref });
      return;
    }
    res.json({ ref: parsed.ref, run: rows[0] });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Wallet Adjustment ───────────────────────────
// Uses adminQuery to bypass RLS — admin must be able to adjust any user's wallet.
router.post('/users/:id/wallet-adjust', async (req, res, next) => {
  try {
    const adminId = req.adminAuth?.userId ?? `admin_token:${req.adminAuth?.method ?? 'unknown'}`;
    const targetUserId = req.params.id;
    const { amountCents, type, reason, idempotencyKey } = req.body as {
      amountCents?: number; type?: string; reason?: string; idempotencyKey?: string;
    };

    if (!amountCents || typeof amountCents !== 'number' || !Number.isInteger(amountCents) || amountCents <= 0 || amountCents > 10_000_00) {
      res.status(400).json({ error: 'amountCents must be a positive integer (max 1000000)' }); return;
    }
    if (!type || (type !== 'credit' && type !== 'debit')) {
      res.status(400).json({ error: 'type must be "credit" or "debit"' }); return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required (min 3 chars)' }); return;
    }

    const idemKey = idempotencyKey ?? `admin_adjust_${targetUserId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    // Bypass RLS for cross-user admin operations: write directly via adminQuery
    const description = `Admin adjustment: ${reason}`;
    const metadata = JSON.stringify({ adminUserId: adminId, reason });

    await adminQuery(
      `INSERT INTO user_wallets (user_id, balance_cents) VALUES ($1, 0) ON CONFLICT (user_id) DO NOTHING`,
      [targetUserId]
    );

    if (type === 'credit') {
      await adminQuery(
        `INSERT INTO wallet_ledger (user_id, amount_cents, entry_type, description, idempotency_key, metadata)
         VALUES ($1, $2, 'credit', $3, $4, $5::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [targetUserId, amountCents, description, idemKey, metadata]
      );
      await adminQuery(
        `UPDATE user_wallets SET balance_cents = balance_cents + $2, updated_at = NOW() WHERE user_id = $1`,
        [targetUserId, amountCents]
      );
    } else {
      await adminQuery(
        `INSERT INTO wallet_ledger (user_id, amount_cents, entry_type, description, idempotency_key, metadata)
         VALUES ($1, $2, 'debit', $3, $4, $5::jsonb)
         ON CONFLICT (idempotency_key) DO NOTHING`,
        [targetUserId, amountCents, description, idemKey, metadata]
      );
      await adminQuery(
        `UPDATE user_wallets SET balance_cents = balance_cents - $2, updated_at = NOW() WHERE user_id = $1`,
        [targetUserId, amountCents]
      );
    }

    const balance = await adminQuery<{ balance_cents: string }>(
      'SELECT balance_cents::text FROM user_wallets WHERE user_id = $1',
      [targetUserId]
    );

    await writeAdminAction(adminId, targetUserId, `wallet_${type}`, reason, {
      amountCents, newBalance: parseInt(balance[0]?.balance_cents ?? '0', 10),
    });

    res.json({ applied: true, balanceCents: parseInt(balance[0]?.balance_cents ?? '0', 10) });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Tier Override ───────────────────────────────
// Uses adminQuery to bypass RLS — admin must be able to change any user's tier.
router.post('/users/:id/tier-override', async (req, res, next) => {
  try {
    const adminId = req.adminAuth?.userId ?? `admin_token:${req.adminAuth?.method ?? 'unknown'}`;
    const targetUserId = req.params.id;
    const { tier, reason } = req.body as { tier?: string; reason?: string };

    if (!tier || !isTierName(tier)) {
      res.status(400).json({ error: 'tier must be a valid tier name' }); return;
    }
    if (!reason || typeof reason !== 'string' || reason.trim().length < 3) {
      res.status(400).json({ error: 'reason is required (min 3 chars)' }); return;
    }

    const now = new Date();
    const periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    await adminQuery(
      `INSERT INTO user_tiers (user_id, tier, current_period_resets_at, updated_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT (user_id) DO UPDATE SET tier = EXCLUDED.tier, updated_at = NOW()`,
      [targetUserId, tier, periodEnd.toISOString()]
    );

    await writeAdminAction(adminId, targetUserId, 'tier_override', reason, { tier });

    res.json({ tier });
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Run Telemetry ──────────────────────────────
router.get('/telemetry/runs', async (req, res, next) => {
  try {
    const rawDays = parseInt(req.query.days as string, 10);
    const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 30));
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
    const limit = Math.max(1, Math.min(parseInt(req.query.limit as string, 10) || 50, 200));
    const offset = Math.max(0, parseInt(req.query.offset as string, 10) || 0);

    let sql = 'SELECT * FROM admin_actions_log WHERE 1=1';
    const params: unknown[] = [];
    let idx = 1;

    if (user_id) { sql += ` AND (admin_user_id = $${idx} OR target_user_id = $${idx})`; params.push(user_id); idx++; }
    if (event_type) { sql += ` AND action = $${idx}`; params.push(event_type); idx++; }
    if (from) { sql += ` AND created_at >= $${idx}`; params.push(from); idx++; }
    if (to) { sql += ` AND created_at <= $${idx}`; params.push(to); idx++; }

    sql += ` ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`;
    params.push(limit, offset);

    try {
      const rows = await adminQuery(sql, params);
      res.json({ entries: rows, limit, offset });
    } catch (dbErr: unknown) {
      if ((dbErr as { code?: string })?.code === '42P01') {
        res.json({ entries: [], limit, offset, notice: 'Audit log table not yet created' });
        return;
      }
      throw dbErr;
    }
  } catch (err) { next(err); }
});

// ─── Admin Dashboard: Cost Analytics ─────────────────────────────────
//
// Backed by migration 030 (agent_executions + model_pricing +
// report_cost_summary view). All endpoints tolerate the migration not
// having applied (Rule 25 I-6) by returning {available:false, reason:
// 'migration_pending'} with HTTP 200 instead of 500.
//
// Read-only — these endpoints never mutate cost data. Pricing edits
// are SQL-only for the initial iteration (see ADR).

interface CostQueryWindow {
  days: number;
  sinceIso: string;
}

function parseCostWindow(req: import('express').Request): CostQueryWindow {
  const rawDays = parseInt(req.query.days as string, 10);
  const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 30));
  const since = new Date();
  since.setDate(since.getDate() - days);
  return { days, sinceIso: since.toISOString() };
}

function isMigrationPending(err: unknown): boolean {
  return (err as { code?: string })?.code === '42P01';
}

// 1. Summary — KPI scorecards at top of dashboard.
router.get('/cost/summary', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const rows = await adminQuery<{
      total_calls: string;
      total_input_tokens: string;
      total_output_tokens: string;
      total_cost_usd: string;
      fallback_calls: string;
      distinct_runs: string;
      distinct_reports: string;
      total_duration_ms: string;
    }>(
      `SELECT
         COUNT(*)::text                                          AS total_calls,
         COALESCE(SUM(input_tokens), 0)::text                    AS total_input_tokens,
         COALESCE(SUM(output_tokens), 0)::text                   AS total_output_tokens,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COUNT(*) FILTER (WHERE used_fallback)::text             AS fallback_calls,
         COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL)::text     AS distinct_runs,
         COUNT(DISTINCT report_id) FILTER (WHERE report_id IS NOT NULL)::text AS distinct_reports,
         COALESCE(SUM(duration_ms), 0)::text                     AS total_duration_ms
       FROM agent_executions
       WHERE created_at >= $1`,
      [sinceIso]
    );
    const r = rows[0];
    const distinctRuns = Number(r?.distinct_runs ?? 0);
    const totalCost = Number(r?.total_cost_usd ?? 0);
    const totalCalls = Number(r?.total_calls ?? 0);
    const fallback = Number(r?.fallback_calls ?? 0);

    res.json({
      available: true,
      days,
      totals: {
        totalCalls,
        totalInputTokens: Number(r?.total_input_tokens ?? 0),
        totalOutputTokens: Number(r?.total_output_tokens ?? 0),
        totalCostUsd: totalCost,
        totalDurationMs: Number(r?.total_duration_ms ?? 0),
        distinctRuns,
        distinctReports: Number(r?.distinct_reports ?? 0),
        fallbackCalls: fallback,
      },
      derived: {
        avgCostPerRunUsd: distinctRuns > 0 ? totalCost / distinctRuns : 0,
        avgCallsPerRun: distinctRuns > 0 ? totalCalls / distinctRuns : 0,
        fallbackRate: totalCalls > 0 ? fallback / totalCalls : 0,
      },
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending' });
      return;
    }
    next(err);
  }
});

// 2. Timeseries — daily cost rollup for the line/area chart.
router.get('/cost/timeseries', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const rows = await adminQuery<{
      day: string;
      total_cost_usd: string;
      total_tokens: string;
      call_count: string;
      distinct_runs: string;
    }>(
      `SELECT
         DATE(created_at)::text                                  AS day,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COALESCE(SUM(total_tokens), 0)::text                    AS total_tokens,
         COUNT(*)::text                                          AS call_count,
         COUNT(DISTINCT run_id) FILTER (WHERE run_id IS NOT NULL)::text AS distinct_runs
       FROM agent_executions
       WHERE created_at >= $1
       GROUP BY DATE(created_at)
       ORDER BY day ASC`,
      [sinceIso]
    );
    res.json({
      available: true,
      days,
      points: rows.map((r) => ({
        day: r.day,
        totalCostUsd: Number(r.total_cost_usd),
        totalTokens: Number(r.total_tokens),
        callCount: Number(r.call_count),
        distinctRuns: Number(r.distinct_runs),
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', points: [] });
      return;
    }
    next(err);
  }
});

// 3. Breakdown — pie/bar data; dimension = 'phase' | 'role' | 'model'.
router.get('/cost/breakdown', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const dimensionRaw = String(req.query.dimension || 'phase').toLowerCase();
    const dimensionCol =
      dimensionRaw === 'role' ? 'agent_role'
        : dimensionRaw === 'model' ? 'model'
        : 'phase';

    const rows = await adminQuery<{
      bucket: string;
      total_cost_usd: string;
      total_tokens: string;
      call_count: string;
    }>(
      `SELECT
         ${dimensionCol}                                         AS bucket,
         COALESCE(SUM(calculated_cost_usd), 0)::text             AS total_cost_usd,
         COALESCE(SUM(total_tokens), 0)::text                    AS total_tokens,
         COUNT(*)::text                                          AS call_count
       FROM agent_executions
       WHERE created_at >= $1
       GROUP BY ${dimensionCol}
       ORDER BY SUM(calculated_cost_usd) DESC NULLS LAST
       LIMIT 50`,
      [sinceIso]
    );
    res.json({
      available: true,
      days,
      dimension: dimensionCol,
      buckets: rows.map((r) => ({
        bucket: r.bucket,
        totalCostUsd: Number(r.total_cost_usd),
        totalTokens: Number(r.total_tokens),
        callCount: Number(r.call_count),
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', buckets: [] });
      return;
    }
    next(err);
  }
});

// 4. Reports — paginated, filterable table of per-run cost rollups.
router.get('/cost/reports', async (req, res, next) => {
  try {
    const { days, sinceIso } = parseCostWindow(req);
    const rawLimit = parseInt(req.query.limit as string, 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(rawLimit) ? rawLimit : 50));
    const rawOffset = parseInt(req.query.offset as string, 10);
    const offset = Math.max(0, Number.isFinite(rawOffset) ? rawOffset : 0);
    const userFilter = (req.query.userId as string | undefined)?.trim() || null;
    const phaseFilter = (req.query.phase as string | undefined)?.trim() || null;

    // Build WHERE clause incrementally — same idiom as /audit-log above.
    const where: string[] = ['ae.created_at >= $1'];
    const params: unknown[] = [sinceIso];
    let p = 2;
    if (userFilter) { where.push(`ae.user_id = $${p}`); params.push(userFilter); p++; }
    if (phaseFilter) {
      // When filtering by phase, only rows in that phase count toward
      // the per-run rollup. Document the semantics in the response.
      where.push(`ae.phase = $${p}`); params.push(phaseFilter); p++;
    }

    const whereAe2 = where.map((clause) => clause.replace(/\bae\./g, 'ae2.'));

    const sql = `
      SELECT
        ae.run_id,
        ae.report_id,
        ae.user_id,
        rr.title                                   AS run_title,
        rr.status                                  AS run_status,
        rr.research_objective,
        COUNT(*)::text                             AS call_count,
        SUM(ae.total_tokens)::text                 AS total_tokens,
        SUM(ae.duration_ms)::text                  AS total_duration_ms,
        SUM(ae.calculated_cost_usd)::text          AS total_cost_usd,
        COUNT(*) FILTER (WHERE ae.used_fallback)::text AS fallback_calls,
        MIN(ae.created_at)                         AS first_call_at,
        MAX(ae.created_at)                         AS last_call_at,
        -- Highest-cost phase for this run within the same window/filters as the outer query.
        (
          SELECT ae2.phase
            FROM agent_executions ae2
           WHERE ${whereAe2.join(' AND ')}
             AND ae2.run_id = ae.run_id
           GROUP BY ae2.phase
           ORDER BY SUM(ae2.calculated_cost_usd) DESC NULLS LAST
           LIMIT 1
        )                                          AS top_phase
      FROM agent_executions ae
      LEFT JOIN research_runs rr ON rr.id = ae.run_id
      WHERE ${where.join(' AND ')}
        AND ae.run_id IS NOT NULL
      GROUP BY ae.run_id, ae.report_id, ae.user_id, rr.title, rr.status, rr.research_objective
      ORDER BY SUM(ae.calculated_cost_usd) DESC NULLS LAST
      LIMIT $${p} OFFSET $${p + 1}
    `;
    params.push(limit, offset);

    const rows = await adminQuery<Record<string, unknown>>(sql, params);

    res.json({
      available: true,
      days,
      limit,
      offset,
      filters: { userId: userFilter, phase: phaseFilter },
      rows: rows.map((r) => ({
        runId: r.run_id,
        reportId: r.report_id,
        userId: r.user_id,
        runTitle: r.run_title,
        runStatus: r.run_status,
        researchObjective: r.research_objective,
        callCount: Number(r.call_count),
        totalTokens: Number(r.total_tokens),
        totalDurationMs: Number(r.total_duration_ms),
        totalCostUsd: Number(r.total_cost_usd),
        fallbackCalls: Number(r.fallback_calls),
        firstCallAt: r.first_call_at,
        lastCallAt: r.last_call_at,
        topPhase: r.top_phase,
      })),
    });
  } catch (err) {
    if (isMigrationPending(err)) {
      res.json({ available: false, reason: 'migration_pending', rows: [] });
      return;
    }
    next(err);
  }
});

// ─── Admin Ops Dashboard (PR3) ─────────────────────────────────────

router.get('/metrics/overview', async (req, res, next) => {
  try {
    const rawDays = parseInt(req.query.days as string, 10);
    const days = Math.max(1, Math.min(365, Number.isFinite(rawDays) ? rawDays : 30));
    const metrics = await getAdminOverviewMetrics(days);
    res.json(metrics);
  } catch (err) {
    next(err);
  }
});

router.get('/reports', async (req, res, next) => {
  try {
    const rawDays = parseInt(req.query.days as string, 10);
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawOffset = parseInt(req.query.offset as string, 10);
    const result = await listAdminReports({
      days: Number.isFinite(rawDays) ? rawDays : undefined,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
      offset: Number.isFinite(rawOffset) ? rawOffset : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/corpus/list', async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search : undefined;
    const rawLimit = parseInt(req.query.limit as string, 10);
    const rawOffset = parseInt(req.query.offset as string, 10);
    const result = await listAdminCorpusSources({
      search,
      limit: Number.isFinite(rawLimit) ? rawLimit : undefined,
      offset: Number.isFinite(rawOffset) ? rawOffset : undefined,
    });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

router.get('/vendors/balances', async (req, res, next) => {
  try {
    const result = await getVendorBalances();
    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ─── Persona conversion rollup ─────────────────────────────────────
router.get('/landing/persona-rollup', async (req, res, next) => {
  try {
    const days = Math.max(1, Math.min(365, parseInt(req.query.days as string, 10) || 30));
    const since = new Date();
    since.setDate(since.getDate() - days);

    const rows = await adminQuery<{
      persona: string;
      view_count: string;
      cta_click_count: string;
    }>(
      `SELECT
         persona,
         COUNT(*) FILTER (WHERE event_type='view')::text       AS view_count,
         COUNT(*) FILTER (WHERE event_type='cta_click')::text  AS cta_click_count
       FROM landing_persona_events
       WHERE bucketed_at >= $1
       GROUP BY persona
       ORDER BY view_count::bigint DESC`,
      [since.toISOString()]
    );

    res.json({
      available: true,
      days,
      personas: rows.map((r) => ({
        persona: r.persona,
        viewCount: Number(r.view_count),
        ctaClickCount: Number(r.cta_click_count),
      })),
    });
  } catch (err) {
    if ((err as { code?: string })?.code === '42P01') {
      res.json({ available: false, reason: 'migration_pending', personas: [] });
      return;
    }
    next(err);
  }
});

export default router;
