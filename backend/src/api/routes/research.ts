import { Router } from 'express';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import { query } from '../../db/pool';
import {
  appendOwnershipFilter,
  buildOwnershipSql,
  rejectUnscopedReadOnScopeError,
} from '../../db/tenantScope';
import type { ResearchJobData } from '../../services/reasoning/researchOrchestrator';
import { researchQueue, intellmeDeletionQueue } from '../../queue/queues';
import { markRunCancelled } from '../../services/researchCancellation';
import { validatePerRunModelOverrides } from '../../services/runtimeModelStore';
import {
  APPROVED_REASONING_MODEL_ALLOWLIST,
  parseResearchObjective,
} from '../../services/reasoning/reasoningModelPolicy';
import { config } from '../../config';
import { handleMulterUpload } from '../../middleware/multerUploadErrors';
import { requireAuth } from '../../middleware/clerkAuth';
import { ingestSupplementalForRun } from '../../services/research/researchSupplementalIngest';
import {
  parseSupplementalUrlCrawlFromBody,
  supplementalUrlCrawlErrorMessage,
} from '../../services/research/supplementalUrlCrawl';
import { V2_MODE_PRESETS } from '../../config/researchEnsemblePresets';
import { enqueueResearchRetryJobWithCleanup } from '../../utils/researchRetryQueueing';
import {
  decideRunStateOnRetryRequest,
  rejectionToHttpBody,
} from '../../services/reasoning/runStateMachine';
import { checkTierAccess } from '../../services/tier/tierService';
import { RESEARCH_ENGINE_VERSION, RUN_CONSUMES_DEEP_QUOTA } from '../../config/researchEngine';
import { releaseHoldForCancelledRun } from '../../services/billing/releaseRunHold';
import { releaseHold } from '../../services/billing/walletReservations';
import { getWalletSummary } from '../../services/billing/walletService';
import {
  buildCreditChargeContextForRun,
  type CreditChargeContext,
} from '../../middleware/creditEnforcement';
import { parseAddonsFromStartRequest } from '../../services/reasoning/parseResearchAddons';
import { getUserTier } from '../../services/tier/tierService';
import { getUserSubscription, type UserSubscription } from '../../services/billing/subscriptionService';
import { resolveEffectiveEntitlementTier } from '../../services/billing/entitlementTier';
import { parseExportStyleInput, VALID_EXPORT_STYLES } from '../../services/formatting/exportStyleGuards';
import { getSavedProfileVisibleToUser } from '../../services/planning/savedOrchestrationProfileService';
import {
  buildPriorReportContextBlock,
  insertQueuedResearchRunWithLineage,
  mergeSupplementalWithPriorContext,
  resolveOwnedReportForSpinoff,
  type SpinoffLineage,
} from '../../services/research/spinoffService';
import { logger } from '../../utils/logger';

const router = Router();

router.use(requireAuth);

const RESEARCH_MAX_FILES = (() => {
  const raw = parseInt(process.env.RESEARCH_MAX_FILES_PER_RUN || '5', 10);
  return Number.isFinite(raw) && raw >= 1 ? raw : 5;
})();

const uploadResearch = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.ingestion.maxFileSizeMb * 1024 * 1024, files: RESEARCH_MAX_FILES },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'text/plain',
      'text/markdown',
      'text/x-markdown',
    ];
    // Use lowercased name so .PDF/.MD etc. are treated the same as .pdf/.md.
    const name = file.originalname.toLowerCase();
    const extOk = name.endsWith('.md') || name.endsWith('.markdown') || name.endsWith('.txt') || name.endsWith('.pdf');
    const ok =
      allowed.includes(file.mimetype) ||
      (file.mimetype === 'application/octet-stream' && extOk);
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

function parseSpinoffFromReportId(body: Record<string, unknown>): string | undefined {
  const raw = body.fromReportId;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed || undefined;
}

async function handleStartResearchRun(
  req: import('express').Request,
  res: import('express').Response,
  next: import('express').NextFunction,
  spinoffFromReportId?: string
): Promise<void> {
    try {
      const isMultipart = Boolean(req.headers['content-type']?.includes('multipart/form-data'));
      const body = req.body as Record<string, string | undefined> & {
        filterTags?: string[] | string;
        modelOverrides?: unknown;
        supplementalUrls?: string[];
        fromReportId?: string;
      };

      const researchQuery = typeof body.query === 'string' ? body.query : '';
      const selectedAddons = parseAddonsFromStartRequest(
        req.body as Record<string, unknown>,
        isMultipart
      );
      const selectedAddonsJson = JSON.stringify(selectedAddons);
      let supplemental = typeof body.supplemental === 'string' ? body.supplemental : '';

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

      let supplementalUrlCrawlRaw: unknown;
      if (isMultipart) {
        supplementalUrlCrawlRaw = body.supplementalUrlCrawl;
      } else {
        supplementalUrlCrawlRaw = (req.body as { supplementalUrlCrawl?: unknown }).supplementalUrlCrawl;
      }
      const supplementalUrlCrawlParsed = parseSupplementalUrlCrawlFromBody(
        supplementalUrlCrawlRaw,
        !isMultipart
          ? (req.body as { supplementalUrlCrawl?: { siteCrawl?: boolean; crawlLayers?: number } })
              .supplementalUrlCrawl
          : null
      );
      if (!supplementalUrlCrawlParsed.ok) {
        res.status(400).json({
          error: supplementalUrlCrawlErrorMessage(supplementalUrlCrawlParsed.error),
        });
        return;
      }
      const supplementalUrlCrawl = supplementalUrlCrawlParsed.crawl;

      let researchObjectiveRaw: unknown;
      let targetWordCountRaw: unknown;
      let requestedFormatsRaw: unknown;
      let requestedResearchObjectiveRaw: unknown;
      let requestedMethodologyRaw: unknown;
      const jsonBodyFull = req.body as { researchObjective?: string; targetWordCount?: unknown; requestedFormats?: unknown; requestedResearchObjective?: unknown; requestedMethodology?: unknown };
      if (isMultipart) {
        researchObjectiveRaw = body.researchObjective;
        targetWordCountRaw = body.targetWordCount;
        requestedFormatsRaw = body.requestedFormats;
        requestedResearchObjectiveRaw = body.requestedResearchObjective;
        requestedMethodologyRaw = body.requestedMethodology;
      } else {
        researchObjectiveRaw = jsonBodyFull.researchObjective;
        targetWordCountRaw = jsonBodyFull.targetWordCount;
        requestedFormatsRaw = jsonBodyFull.requestedFormats;
        requestedResearchObjectiveRaw = jsonBodyFull.requestedResearchObjective;
        requestedMethodologyRaw = jsonBodyFull.requestedMethodology;
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

      const requestedFormatsParsed = isMultipart
        ? typeof requestedFormatsRaw === 'string'
          ? parseJsonField<unknown[]>(requestedFormatsRaw, [])
          : requestedFormatsRaw
        : requestedFormatsRaw;
      const requestedFormats = Array.isArray(requestedFormatsParsed)
        ? requestedFormatsParsed.filter((f): f is string => typeof f === 'string')
        : undefined;
      const requestedResearchObjective =
        typeof requestedResearchObjectiveRaw === 'string' ? requestedResearchObjectiveRaw : undefined;
      const requestedMethodology =
        typeof requestedMethodologyRaw === 'string' ? requestedMethodologyRaw : undefined;

      const files = (req.files as Express.Multer.File[] | undefined) ?? [];

      if (!researchQuery || typeof researchQuery !== 'string') {
        res.status(400).json({ error: 'query is required' });
        return;
      }

      const userId = req.auth?.userId;
      const orgId = req.auth?.orgId ?? null;

      let spinoffLineage: SpinoffLineage | undefined;
      if (spinoffFromReportId) {
        const parent = await resolveOwnedReportForSpinoff(spinoffFromReportId, {
          userId: userId ?? null,
          orgId,
        });
        if (!parent) {
          res.status(404).json({ error: 'Report not found' });
          return;
        }
        const priorBlock = await buildPriorReportContextBlock(spinoffFromReportId);
        supplemental = mergeSupplementalWithPriorContext(supplemental, priorBlock);
        spinoffLineage = {
          spinoffFromRunId: parent.runId,
          spinoffFromReportId: parent.reportId,
        };
      }

      let researchObjective = parseResearchObjective(
        typeof researchObjectiveRaw === 'string' ? researchObjectiveRaw : undefined
      );
      if (researchObjectiveRaw != null && researchObjectiveRaw !== '' && !researchObjective) {
        res.status(400).json({ error: 'invalid researchObjective' });
        return;
      }
      // Whether the caller actually chose an objective, captured BEFORE the v2
      // placeholder below overwrites the distinction. The worker uses this to
      // decide if the intent-derived objective may take over (WO-AA Phase 6).
      const researchObjectiveExplicit = Boolean(researchObjective);
      if (!researchObjective) {
        // Pricing and persistence need a concrete value here; intent
        // classification has not run yet. Marked non-explicit above so the
        // orchestrator can replace it once the brief resolves.
        researchObjective = 'GENERAL_EPISTEMIC_RESEARCH';
      }

      let citationStyle: string | undefined;
      if (isMultipart) {
        const rawCs = body.citation_style ?? body.citationStyle;
        citationStyle = parseExportStyleInput(typeof rawCs === 'string' ? rawCs : undefined);
      } else {
        const jb = req.body as { citation_style?: unknown; citationStyle?: unknown };
        citationStyle = parseExportStyleInput(jb.citation_style ?? jb.citationStyle);
      }
      const hadCitationStyleField = isMultipart
        ? body.citation_style != null || body.citationStyle != null
        : (req.body as { citation_style?: unknown }).citation_style != null ||
          (req.body as { citationStyle?: unknown }).citationStyle != null;
      if (hadCitationStyleField && !citationStyle) {
        res.status(400).json({
          error: 'invalid citation_style',
          validStyles: Array.from(VALID_EXPORT_STYLES),
        });
        return;
      }

      // Tier enforcement: check access before creating the run
      let subscriptionRow: UserSubscription | undefined;
      if (userId) {
        let walletBalanceCents = 0;
        try {
          const wallet = await getWalletSummary(userId);
          walletBalanceCents = wallet.balanceCents;
        } catch {
          // wallet service may not be available yet
        }
        subscriptionRow = await getUserSubscription(userId);
        const tierCheck = await checkTierAccess(
          userId,
          researchObjective ?? null,
          walletBalanceCents,
          RUN_CONSUMES_DEEP_QUOTA,
          subscriptionRow
        );
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

      const orgIdClerk =
        typeof req.auth?.orgId === 'string' && req.auth.orgId.trim() ? req.auth.orgId.trim() : null;
      const profileIdRaw = (() => {
        if (isMultipart) {
          const raw = body.savedOrchestrationProfileId as string | undefined;
          return typeof raw === 'string' ? raw.trim() : '';
        }
        const j = req.body as { savedOrchestrationProfileId?: unknown };
        return typeof j.savedOrchestrationProfileId === 'string' ? j.savedOrchestrationProfileId.trim() : '';
      })();

      let savedOrchestrationProfileSeed: ResearchJobData['savedOrchestrationProfileSeed'];
      if (userId && profileIdRaw) {
        const row = await getSavedProfileVisibleToUser(userId, orgIdClerk, profileIdRaw);
        if (!row) {
          res.status(400).json({ error: 'Invalid or unavailable saved orchestration profile' });
          return;
        }
        savedOrchestrationProfileSeed = {
          baseIntent: row.baseIntent,
          customizations: row.customizations,
          profileName: row.name,
        };
      }

      const fileItems = files.map((f) => ({
        originalname: f.originalname,
        mimetype: f.mimetype,
        buffer: f.buffer,
      }));

      const ingestSummary = await ingestSupplementalForRun({
        runId,
        urls: supplementalUrls,
        files: fileItems,
        userId: userId ?? undefined,
        urlCrawl: supplementalUrlCrawl,
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

      await insertQueuedResearchRunWithLineage({
        runId,
        title,
        query: researchQuery,
        supplemental: supplemental ?? '',
        normalizedOverridesJson: JSON.stringify(normalizedOverrides),
        attachmentsJson: JSON.stringify(attachments),
        engineVersion: RESEARCH_ENGINE_VERSION,
        researchObjective: researchObjective ?? null,
        targetWordCount: targetWordCount ?? null,
        requestedFormats: requestedFormats ?? null,
        requestedResearchObjective: requestedResearchObjective ?? null,
        requestedMethodology: requestedMethodology ?? null,
        userId: userId ?? null,
        orgId,
        lineage: spinoffLineage,
        selectedAddonsJson,
      });

      if (citationStyle || requestedFormats || requestedResearchObjective || requestedMethodology) {
        try {
          await query(`UPDATE research_runs SET citation_style=COALESCE($1, citation_style), requested_formats=COALESCE($2::jsonb, requested_formats), requested_research_objective=COALESCE($3, requested_research_objective), requested_methodology=COALESCE($4, requested_methodology) WHERE id=$5`, [citationStyle ?? null, requestedFormats ? JSON.stringify(requestedFormats) : null, requestedResearchObjective ?? null, requestedMethodology ?? null, runId]);
        } catch (citeErr) {
          const citeCode = (citeErr as { code?: string } | null)?.code;
          if (citeCode !== '42703') throw citeErr;
        }
      }

      // Credit enforcement: compute cost, place wallet hold if needed
      let creditChargeContext: CreditChargeContext | undefined;
      if (userId) {
        try {
          const userTier = await getUserTier(userId);
          const sub = subscriptionRow ?? (await getUserSubscription(userId));
          const entitlementTier = resolveEffectiveEntitlementTier(sub, userTier.tier);

          const creditResult = await buildCreditChargeContextForRun({
            userId,
            runId,
            entitlementTier,
            researchObjective,
            addons: selectedAddons,
            currentPeriodReportsUsed: userTier.current_period_reports_used,
          });
          if (!creditResult.ok) {
            res.status(creditResult.status).json(creditResult.body);
            return;
          }
          creditChargeContext = creditResult.context;
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
          engineVersion: RESEARCH_ENGINE_VERSION,
          researchObjective: researchObjective ?? undefined,
          researchObjectiveExplicit,
          targetWordCount,
          requestedFormats,
          requestedResearchObjective,
          requestedMethodology,
          citationStyle,
          creditChargeContext,
          savedOrchestrationProfileSeed,
          addons: selectedAddons.length > 0 ? selectedAddons : undefined,
        },
        { jobId: runId }
      );

      res.status(202).json({
        runId,
        status: 'queued',
        supplementalIngest: {
          urlsQueued: ingestSummary.urlsQueued,
          filesQueued: ingestSummary.filesQueued,
          filesAttempted: ingestSummary.filesAttempted,
          jobIds: ingestSummary.jobIds,
          fileOutcomes: ingestSummary.fileOutcomes,
          ingestOutcomes: ingestSummary.ingestOutcomes,
        },
      });
    } catch (err) {
      next(err);
    }
}

const startResearchUpload = handleMulterUpload((req, res, next) => {
  const ct = req.headers['content-type'] || '';
  if (ct.includes('multipart/form-data')) {
    uploadResearch.array('files', RESEARCH_MAX_FILES)(req, res, next);
  } else {
    next();
  }
});

// POST /api/research - Start a research run (JSON or multipart with supplemental files)
router.post('/', startResearchUpload, (req, res, next) => {
  void handleStartResearchRun(req, res, next);
});

// POST /api/research/spinoff — full research from an existing report (Gate 2)
router.post('/spinoff', startResearchUpload, (req, res, next) => {
  const fromReportId = parseSpinoffFromReportId(req.body as Record<string, unknown>);
  if (!fromReportId) {
    res.status(400).json({ error: 'fromReportId is required' });
    return;
  }
  void handleStartResearchRun(req, res, next, fromReportId);
});

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
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    // Columns added by later migrations, newest first. The application can be
    // live before a migration applies, so on 42703 the newest optional column
    // is dropped and the read retried, rather than failing the whole list.
    //
    // `run_ref` is what a user quotes to support and `display_title` is what
    // every surface shows instead of the raw prompt, so both have to reach the
    // client whenever they exist. Dropping them one at a time matters: a single
    // combined fallback would lose `run_ref` too on a database that has 055 but
    // not 057 — which is every database for the length of one deploy.
    const OPTIONAL_RUN_COLUMNS = ['display_title', 'run_ref'] as const;
    const baseCols = `id, title, LEFT(query, 512) AS query, supplemental, supplemental_attachments, engine_version, research_objective, status, error_message, failed_stage, failure_meta,
                      progress_stage, progress_percent, progress_message, progress_updated_at,
                      started_at, completed_at, created_at, report_id`;

    let rows: unknown[];
    try {
      const params: unknown[] = [];
      const conds: string[] = [];
      appendOwnershipFilter(conds, params, { userId, orgId });
      let where = ` WHERE ${conds[0]}`;
      if (status) {
        params.push(status);
        where += ` AND status=$${params.length}`;
      }
      const suffix = `FROM research_runs${where} ORDER BY created_at DESC LIMIT 50`;
      let optional: readonly string[] = OPTIONAL_RUN_COLUMNS;
      for (;;) {
        const cols = optional.length > 0 ? `${baseCols}, ${optional.join(', ')}` : baseCols;
        try {
          rows = await query(`SELECT ${cols} ${suffix}`, params);
          break;
        } catch (colErr) {
          // Out of columns to drop, or a failure that is not a missing column:
          // this is a real error and must surface rather than loop.
          if ((colErr as { code?: string })?.code !== '42703' || optional.length === 0) throw colErr;
          optional = optional.slice(1);
        }
      }
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'GET /api/research');
    }

    res.json(rows);
  } catch (err) {
    next(err);
  }
});

// GET /api/research/:id - Get specific run
router.get('/:id', async (req, res, next) => {
  try {
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let rows: unknown[];
    try {
      rows = await query(
        `SELECT * FROM research_runs WHERE id=$1 AND ${buildOwnershipSql('', 2, 3)}`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'GET /api/research/:id');
    }

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
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

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
           FROM research_runs WHERE id=$1 AND ${buildOwnershipSql('', 2, 3)}`,
        [runId, userId, orgId]
      );
    } catch (selectErr) {
      rejectUnscopedReadOnScopeError(selectErr, 'GET /api/research/:id/artifacts');
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
    // Scoped to the caller. This read was `WHERE id=$1` with no ownership
    // filter, so any signed-in user who knew or guessed a run id could cancel
    // someone else's research — including a run mid-execution. Nothing in the
    // UI reached this endpoint, which is presumably why it went unnoticed; WO-AH
    // puts a Cancel button on the run workspace, so it is fixed in the same
    // change rather than exposed as-is.
    //
    // A run the caller does not own is 404, not 403: an id that is not theirs
    // should not be confirmable as existing.
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let rows: Array<{ id: string; status: string }>;
    try {
      rows = await query<{ id: string; status: string }>(
        `SELECT id, status FROM research_runs WHERE id=$1 AND ${buildOwnershipSql('', 2, 3)}`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'POST /api/research/:id/cancel');
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const { status } = rows[0];
    if (status === 'completed' || status === 'failed' || status === 'cancelled' || status === 'aborted') {
      res.status(400).json({ error: `Cannot cancel run in status ${status}` });
      return;
    }
    if (status === 'queued') {
      const job = await researchQueue.getJob(req.params.id);
      const creditContext =
        job?.data && typeof job.data === 'object' && !Array.isArray(job.data)
          ? (job.data as ResearchJobData).creditChargeContext
          : null;
      if (job) {
        try {
          await job.remove();
        } catch (removeErr) {
          await markRunCancelled(req.params.id);
          logger.warn('queued_cancel_job_remove_lost_race', {
            runId: req.params.id,
            error: removeErr instanceof Error ? removeErr.message : String(removeErr),
          });
          res.json({ ok: true, status: 'cancellation_requested' });
          return;
        }
      }
      if (creditContext?.holdId && creditContext.userId) {
        await releaseHold(creditContext.holdId, creditContext.userId).catch((releaseErr) => {
          logger.warn('queued_cancel_hold_release_failed', {
            runId: req.params.id,
            holdId: creditContext.holdId,
            error: releaseErr instanceof Error ? releaseErr.message : String(releaseErr),
          });
        });
      } else {
        await releaseHoldForCancelledRun(req.params.id);
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
    // A run parked at the plan gate has no queue job and is not executing, so it
    // cancels like a queued one. It used to fall through to "Unexpected run
    // status", which meant the one state a user is most likely to abandon was
    // the one state they could not abandon.
    if (status === 'plan_pending_confirmation') {
      await releaseHoldForCancelledRun(req.params.id);
      await query(
        `UPDATE research_runs SET status='cancelled', completed_at=NOW(), error_message='Cancelled by user' WHERE id=$1`,
        [req.params.id]
      );
      res.json({ ok: true, status: 'cancelled' });
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
    const userId = req.auth?.userId ?? null;
    const orgId = req.auth?.orgId ?? null;

    let rows: { status: string; user_id: string | null }[];
    try {
      rows = await query<{ status: string; user_id: string | null }>(
        `SELECT status, user_id FROM research_runs WHERE id=$1 AND ${buildOwnershipSql('', 2, 3)}`,
        [req.params.id, userId, orgId]
      );
    } catch (scopeErr) {
      rejectUnscopedReadOnScopeError(scopeErr, 'DELETE /api/research/:id');
    }

    if (rows.length === 0) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    const { status, user_id } = rows[0];
    if (status === 'running') {
      res.status(400).json({ error: 'Cannot delete a running run; cancel first' });
      return;
    }
    if (status === 'queued') {
      const job = await researchQueue.getJob(req.params.id);
      if (job) await job.remove();
    }

    // Enqueue InTellMe deletion if the run had a Pipeline B document ingested.
    // Best-effort: do not block the delete response on queue failures.
    try {
      const ingestionRows = await query<{ intellme_request_id: string | null }>(
        `SELECT intellme_request_id FROM run_ingestion_state WHERE run_id=$1`,
        [req.params.id]
      );
      const docId = ingestionRows[0]?.intellme_request_id;
      const deletionUserId = userId ?? user_id ?? null;
      if (docId && deletionUserId) {
        await intellmeDeletionQueue.add(`delete-${req.params.id}`, {
          runId: req.params.id,
          userId: deletionUserId,
          documentId: docId,
        });
      }
    } catch {
      // Deploy-skew tolerance: table may not exist yet (migration 023)
    }

    await query(`DELETE FROM research_runs WHERE id=$1`, [req.params.id]);
    res.status(204).send();
  } catch (err) {
    next(err);
  }
});

export default router;
