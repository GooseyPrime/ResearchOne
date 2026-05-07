import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import type { ResearchJobData } from '../../services/reasoning/researchOrchestrator';
import { researchQueue } from '../../queue/queues';
import { markRunCancelled } from '../../services/researchCancellation';
import { validatePerRunModelOverrides } from '../../services/runtimeModelStore';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  parseResearchObjective,
} from '../../services/reasoning/reasoningModelPolicy';
import { config } from '../../config';
import { requireAuth } from '../../middleware/clerkAuth';
import { ingestSupplementalForRun } from '../../services/research/researchSupplementalIngest';
import { V2_MODE_PRESETS } from '../../config/researchEnsemblePresets';
import { enqueueResearchRetryJobWithCleanup } from '../../utils/researchRetryQueueing';
import {
  decideRunStateOnRetryRequest,
  rejectionToHttpBody,
} from '../../services/reasoning/runStateMachine';
import { checkTierAccess } from '../../services/tier/tierService';
import { getWalletSummary } from '../../services/billing/walletService';
import { computeRunCost, type CreditChargeContext } from '../../middleware/creditEnforcement';
import { getUserTier } from '../../services/tier/tierService';
import { TIER_RULES } from '../../config/tierRules';
import { placeHold } from '../../services/billing/walletReservations';

const router = Router();

router.use(requireAuth);

const uploadResearch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024, files: 25 },
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
    const ok =
      allowed.includes(file.mimetype) ||
      name.endsWith('.md') ||
      name.endsWith('.txt') ||
      name.endsWith('.pdf');
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

      let engineVersion: string | undefined;
      let researchObjectiveRaw: unknown;
      let targetWordCountRaw: unknown;
      const jsonBodyFull = req.body as { engineVersion?: string; researchObjective?: string; targetWordCount?: unknown };
      if (isMultipart) {
        const ev = body.engineVersion;
        engineVersion = typeof ev === 'string' ? ev.trim() : undefined;
        researchObjectiveRaw = body.researchObjective;
        targetWordCountRaw = body.targetWordCount;
      } else {
        engineVersion = typeof jsonBodyFull.engineVersion === 'string' ? jsonBodyFull.engineVersion.trim() : undefined;
        researchObjectiveRaw = jsonBodyFull.researchObjective;
        targetWordCountRaw = jsonBodyFull.targetWordCount;
      }
      let targetWordCount: number | undefined;
      const parsedWords =
        typeof targetWordCountRaw === 'string'
          ? Number(targetWordCountRaw)
          : typeof targetWordCountRaw === 'number'
            ? targetWordCountRaw
            : NaN;
      if (Number.isFinite(parsedWords) && parsedWords > 0) {
        // Clamp at the route level so a malformed value never reaches the
        // orchestrator. The synthesizer also clamps but enforcing here keeps
        // the resume_job_payload clean. Floor matches the synthesizer's
        // SECTION_PLAN.length × per-section floor (10 × 80 = 800).
        targetWordCount = Math.max(800, Math.min(12000, Math.round(parsedWords)));
      }

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (!researchQuery || typeof researchQuery !== 'string') {
        res.status(400).json({ error: 'query is required' });
        return;
      }

      const eng = engineVersion ?? '';
      if (eng && eng !== 'v2') {
        res.status(400).json({ error: 'engineVersion must be "v2" when set' });
        return;
      }

      let researchObjective = parseResearchObjective(
        typeof researchObjectiveRaw === 'string' ? researchObjectiveRaw : undefined
      );
      if (researchObjectiveRaw != null && researchObjectiveRaw !== '' && !researchObjective) {
        res.status(400).json({ error: 'invalid researchObjective' });
        return;
      }
      if (eng === 'v2' && !researchObjective) {
        researchObjective = 'GENERAL_EPISTEMIC_RESEARCH';
      }

      // Tier enforcement: check access before creating the run
      const userId = req.auth?.userId;
      if (userId) {
        let walletBalanceCents = 0;
        try {
          const wallet = await getWalletSummary(userId);
          walletBalanceCents = wallet.balanceCents;
        } catch {
          // wallet service may not be available yet
        }
        const tierCheck = await checkTierAccess(userId, researchObjective ?? null, walletBalanceCents);
        if (!tierCheck.allowed) {
          const status = tierCheck.httpStatus ?? 403;
          const body: Record<string, unknown> = { error: tierCheck.reason };
          if (tierCheck.upgradePath) body.upgrade_path = tierCheck.upgradePath;
          if (tierCheck.checkoutPath) body.checkout_path = tierCheck.checkoutPath;
          res.status(status).json(body);
          return;
        }
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

      // INSERT — try the new schema first (with target_word_count). If migration
      // 013 has not yet been applied, fall back to the legacy column set so the
      // route does not 500 during a deploy gap. Only the specific
      // "undefined column" error (Postgres SQLSTATE 42703) is recovered;
      // everything else (connectivity, constraint violations, etc.) is
      // rethrown so real failures aren't masked (Copilot PR #50 review).
      try {
        await query(
          `INSERT INTO research_runs (id, title, query, supplemental, status, model_overrides, supplemental_attachments, engine_version, research_objective, target_word_count)
           VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8, $9)`,
          [
            runId,
            title,
            researchQuery,
            supplemental ?? '',
            JSON.stringify(normalizedOverrides),
            JSON.stringify(attachments),
            eng === 'v2' ? 'v2' : null,
            researchObjective ?? null,
            targetWordCount ?? null,
          ]
        );
      } catch (insertErr) {
        const code = (insertErr as { code?: string } | null)?.code;
        if (code !== '42703') throw insertErr;
        await query(
          `INSERT INTO research_runs (id, title, query, supplemental, status, model_overrides, supplemental_attachments, engine_version, research_objective)
           VALUES ($1, $2, $3, $4, 'queued', $5, $6::jsonb, $7, $8)`,
          [
            runId,
            title,
            researchQuery,
            supplemental ?? '',
            JSON.stringify(normalizedOverrides),
            JSON.stringify(attachments),
            eng === 'v2' ? 'v2' : null,
            researchObjective ?? null,
          ]
        );
      }

      // Credit enforcement: compute cost, place wallet hold if needed
      let creditChargeContext: CreditChargeContext | undefined;
      if (userId) {
        try {
          const userTier = await getUserTier(userId);
          const rules = TIER_RULES[userTier.tier] ?? TIER_RULES.free_demo;
          const addons = (req.body as { addons?: string[] }).addons;

          if (userTier.tier === 'byok' || userTier.tier === 'admin' || userTier.tier === 'sovereign') {
            creditChargeContext = { type: 'byok', costCents: 0 };
          } else {
            const { costCents, errors } = computeRunCost(userTier.tier, researchObjective, addons);
            if (errors.length > 0) {
              const first = errors[0];
              res.status(first.status).json({ error: first.message, errors });
              return;
            }

            const withinMonthlyCap = rules.monthlyReportCap !== null &&
              userTier.current_period_reports_used < rules.monthlyReportCap;

            if (withinMonthlyCap) {
              creditChargeContext = { type: 'subscription', costCents: 0, subscriptionQuotaToDecrement: 1, userId };
            } else if (rules.walletFallbackEnabled || rules.monthlyReportCap === null) {
              const holdResult = await placeHold(userId, runId, costCents);
              if (!holdResult.success) {
                res.status(402).json({
                  error: 'Insufficient wallet balance',
                  available_balance_cents: holdResult.availableBalanceCents,
                  required_cents: costCents,
                  checkout_path: '/app/billing',
                });
                return;
              }
              creditChargeContext = { type: 'wallet', costCents, holdId: holdResult.holdId, userId };
            } else {
              creditChargeContext = { type: 'none', costCents: 0 };
            }
          }
        } catch (creditErr) {
          // Deploy-skew tolerance: if wallet_holds table doesn't exist, proceed without credit enforcement
          const pgCode = (creditErr as { code?: string })?.code;
          if (pgCode === '42P01' || pgCode === '42703') {
            creditChargeContext = undefined;
          } else {
            throw creditErr;
          }
        }
      }

      await researchQueue.add(
        'research-run',
        {
          runId,
          query: researchQuery,
          supplemental,
          filterTags,
          modelOverrides: normalizedOverrides,
          engineVersion: eng === 'v2' ? 'v2' : undefined,
          researchObjective: researchObjective ?? undefined,
          targetWordCount,
          creditChargeContext,
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

// GET /api/research/v2/ensemble-presets — Research One 2 objective-based defaults (before /:id)
router.get('/v2/ensemble-presets', async (_req, res, next) => {
  try {
    res.json({
      presets: V2_MODE_PRESETS,
      allowlist: APPROVED_REASONING_MODEL_ALLOWLIST,
    });
  } catch (err) {
    next(err);
  }
});

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
    let sql = `SELECT id, title, query, supplemental, supplemental_attachments, engine_version, research_objective, status, error_message, failed_stage, failure_meta,
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

// GET /api/research/:id/artifacts — sources + claims + checkpoints collected during any run (failed or succeeded)
router.get('/:id/artifacts', async (req, res, next) => {
  try {
    const runId = req.params.id;

    type RunMetaRow = {
      id: string;
      progress_events: unknown;
      plan: unknown;
      discovery_summary: unknown;
      model_log: unknown;
      model_overrides: unknown;
      model_ensemble: unknown;
      report_id: string | null;
    };
    let runMeta: RunMetaRow[] = [];
    try {
      runMeta = await query<RunMetaRow>(
        `SELECT id, progress_events, plan, discovery_summary, model_log, model_overrides, model_ensemble, report_id
           FROM research_runs WHERE id=$1`,
        [runId]
      );
    } catch (selectErr) {
      // Tolerate deploy-skew where some columns above are not yet present
      // (Postgres SQLSTATE 42703 — undefined_column). Any other error
      // (connection loss, permission, etc.) is rethrown so operational
      // problems aren't masked (Copilot PR #50 review).
      const code = (selectErr as { code?: string } | null)?.code;
      if (code !== '42703') throw selectErr;
      runMeta = (await query<{ id: string }>(
        `SELECT id FROM research_runs WHERE id=$1`,
        [runId]
      )) as RunMetaRow[];
    }
    if (runMeta.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const meta = runMeta[0];

    const [sources, claims, checkpoints, discoveryEvents, totals] = await Promise.all([
      query<{
        id: string; title: string | null; url: string | null; source_type: string;
        tags: string[]; ingested_at: string;
      }>(
        `SELECT id, title, url, source_type, COALESCE(tags, '{}'::text[]) AS tags, ingested_at
         FROM sources
         WHERE discovered_by_run_id=$1
         ORDER BY ingested_at ASC
         LIMIT 100`,
        [runId]
      ),
      query<{
        id: string; claim_text: string; evidence_tier: string | null; source_id: string | null;
      }>(
        `SELECT id, claim_text, evidence_tier, source_id
         FROM claims
         WHERE run_id=$1 AND claim_text IS NOT NULL
         ORDER BY created_at ASC
         LIMIT 200`,
        [runId]
      ),
      query<{
        stage: string; checkpoint_key: string; snapshot: Record<string, unknown>; created_at: string;
      }>(
        `SELECT stage, checkpoint_key, snapshot, created_at
         FROM research_run_checkpoints
         WHERE run_id=$1
         ORDER BY created_at ASC`,
        [runId]
      ),
      query<{
        phase: string; provider: string; query_text: string; result_count: number;
        selected_count: number; payload: Record<string, unknown>; created_at: string;
      }>(
        `SELECT phase, provider, query_text, result_count, selected_count, payload, created_at
         FROM discovery_events
         WHERE run_id=$1
         ORDER BY created_at ASC`,
        [runId]
      ).catch(() => []),
      query<{ sources_total: string; claims_total: string }>(
        `SELECT
           (SELECT COUNT(*) FROM sources WHERE discovered_by_run_id=$1)::text AS sources_total,
           (SELECT COUNT(*) FROM claims WHERE run_id=$1 AND claim_text IS NOT NULL)::text AS claims_total`,
        [runId]
      ),
    ]);

    const sourcesTotal = parseInt(totals[0]?.sources_total ?? '0', 10);
    const claimsTotal = parseInt(totals[0]?.claims_total ?? '0', 10);

    res.json({
      sources,
      claims,
      checkpoints,
      sourcesTotal,
      claimsTotal,
      progressEvents: Array.isArray(meta.progress_events) ? meta.progress_events : [],
      plan: meta.plan ?? null,
      discoverySummary: meta.discovery_summary ?? null,
      discoveryEvents,
      modelLog: Array.isArray(meta.model_log) ? meta.model_log : [],
      modelOverrides: meta.model_overrides ?? null,
      modelEnsemble: meta.model_ensemble ?? null,
      reportId: meta.report_id ?? null,
    });
  } catch (err) {
    next(err);
  }
});

// POST /api/research/:id/retry-from-failure — re-queue a failed retryable run with preserved job payload
router.post('/:id/retry-from-failure', async (req, res, next) => {
  try {
    type RetryRow = {
      id: string;
      status: string;
      failure_meta: Record<string, unknown> | null;
      resume_job_payload: unknown;
      retry_attempts: number | null;
      retry_budget: number | null;
    };

    // Tolerate deploy-skew between code and migration 012 (the migration
    // adds `retry_attempts` / `retry_budget` columns). When the columns
    // are missing, Postgres throws "column does not exist" and the SELECT
    // would otherwise turn this endpoint into a 500. We retry without
    // those columns and default attempts/budget to 0/3, which keeps the
    // retry path deterministic until the migration lands.
    let rows: RetryRow[] = [];
    try {
      rows = await query<RetryRow>(
        `SELECT id, status, failure_meta, resume_job_payload, retry_attempts, retry_budget FROM research_runs WHERE id=$1`,
        [req.params.id]
      );
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const undefinedColumn =
        e?.code === '42703' ||
        (typeof e?.message === 'string' && /column .* does not exist/i.test(e.message));
      if (!undefinedColumn) throw err;
      const fallback = await query<Omit<RetryRow, 'retry_attempts' | 'retry_budget'>>(
        `SELECT id, status, failure_meta, resume_job_payload FROM research_runs WHERE id=$1`,
        [req.params.id]
      );
      rows = fallback.map((r) => ({ ...r, retry_attempts: null, retry_budget: null }));
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    const row = rows[0];
    const retryAttempts = Number(row.retry_attempts ?? 0);
    const retryBudget = Number(row.retry_budget ?? 3);

    // Single source of truth: state machine decides whether the request is
    // accepted and emits the canonical failure_meta to persist on retry.
    const decision = decideRunStateOnRetryRequest({
      currentStatus: row.status,
      currentFailureMeta: row.failure_meta,
      retryAttempts,
      retryBudget,
      resumePayload: row.resume_job_payload,
      expectedRunId: req.params.id,
    });

    if (!decision.ok) {
      // For budget_exhausted, also flip the row to a terminal state
      // defensively so the UI catches up if the orchestrator missed it.
      // If the 'aborted' enum value is not present yet (deploy ahead of
      // migration 012), fall back to status='failed' with
      // failure_meta.terminal=true. Either way, we always still return the
      // deterministic 400 — never let this path 500. (Copilot PR #40
      // review.)
      if (decision.reason === 'budget_exhausted') {
        try {
          await query(
            `UPDATE research_runs SET status='aborted', resume_job_payload=NULL WHERE id=$1`,
            [req.params.id]
          );
        } catch (abortErr) {
          const ae = abortErr as { code?: string; message?: string };
          const enumMissing =
            ae?.code === '22P02' ||
            (typeof ae?.message === 'string' && /invalid input value for enum/i.test(ae.message));
          if (!enumMissing) {
            // Some other failure — log and keep going to send the 400.
            // The orchestrator may converge on the next failure write.
            // Intentionally swallowed: the user-facing 400 is still correct.
          }
          const terminalFailureMeta: Record<string, unknown> = {
            ...((row.failure_meta as Record<string, unknown> | null) ?? {}),
            terminal: true,
            retryable: false,
            resumeAvailable: false,
            abortReason: 'budget_exhausted',
            retryAttempts,
            retryBudget,
            attemptsRemaining: 0,
          };
          try {
            await query(
              `UPDATE research_runs
                  SET status='failed',
                      failure_meta=$2,
                      resume_job_payload=NULL
                WHERE id=$1`,
              [req.params.id, JSON.stringify(terminalFailureMeta)]
            );
          } catch {
            // Preserve the deterministic 400 response even if the
            // defensive state update cannot be persisted. The frontend
            // state machine will still classify this as `aborted` because
            // the response body has `terminal: true`.
          }
        }
      }
      res.status(400).json(rejectionToHttpBody(decision));
      return;
    }

    const payload = row.resume_job_payload as ResearchJobData;

    // The retry_attempts column may not exist if migration 012 hasn't
    // applied yet on this deploy. Try the full UPDATE first, then fall
    // back to one without retry_attempts so the retry can still proceed
    // without the budget bookkeeping (which the in-memory state machine
    // already enforced via `decision`).
    try {
      await query(
        `UPDATE research_runs
            SET status='queued',
                error_message=NULL,
                failed_stage=NULL,
                failure_meta=$2,
                retry_attempts=$3,
                progress_stage='queued',
                progress_percent=0,
                progress_message='Retry queued from failure',
                progress_updated_at=NOW(),
                completed_at=NULL
          WHERE id=$1`,
        [req.params.id, JSON.stringify(decision.failureMeta), decision.nextRetryAttempts]
      );
    } catch (err) {
      const e = err as { code?: string; message?: string };
      const undefinedColumn =
        e?.code === '42703' ||
        (typeof e?.message === 'string' && /column .* does not exist/i.test(e.message));
      if (!undefinedColumn) throw err;
      await query(
        `UPDATE research_runs
            SET status='queued',
                error_message=NULL,
                failed_stage=NULL,
                failure_meta=$2,
                progress_stage='queued',
                progress_percent=0,
                progress_message='Retry queued from failure',
                progress_updated_at=NOW(),
                completed_at=NULL
          WHERE id=$1`,
        [req.params.id, JSON.stringify(decision.failureMeta)]
      );
    }

    await enqueueResearchRetryJobWithCleanup(researchQueue, req.params.id, payload);

    await query(
      `UPDATE research_runs
          SET progress_events = CASE
              WHEN jsonb_typeof(progress_events) = 'array'
                THEN (progress_events || $2::jsonb)
              ELSE $2::jsonb
            END
        WHERE id = $1`,
      [
        req.params.id,
        JSON.stringify([
          {
            runId: req.params.id,
            stage: 'queued',
            percent: 0,
            message: 'Retry queued from failure',
            timestamp: new Date().toISOString(),
            eventType: 'run_resumed',
          },
        ]),
      ]
    );

    res.json({
      ok: true,
      status: 'queued',
      retryAttempts: decision.nextRetryAttempts,
      retryBudget: decision.retryBudget,
      attemptsRemaining: decision.attemptsRemaining,
    });
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
