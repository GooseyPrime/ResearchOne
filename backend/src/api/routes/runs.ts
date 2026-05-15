/**
 * Wave 5.1 — Plan confirmation gate API (Rule 33).
 * Mutations use planWriteService; reads use v_dossier via dossierReadService.
 */
import { Router, type Request, type Response, type NextFunction } from 'express';
import type { Server as SocketIOServer } from 'socket.io';
import { requireAuth } from '../../middleware/clerkAuth';
import { queryOne } from '../../db/pool';
import { getDossierByRunId } from '../../services/research/dossierReadService';
import type { DossierAuthContext } from '../../types/dossier';
import {
  bumpPlanConfirmationStreakIfCleanConfirm,
  resetPlanConfirmationStreak,
} from '../../services/planning/accountPreferencesService';
import {
  appendPlanRevision,
  cancelRunAtPlanGate,
  confirmGatePlan,
  getGatePlanRowForRun,
  listPlanRevisionsForRun,
  markRunRunningAfterPlanConfirm,
} from '../../services/planning/planWriteService';
import { refinePlan } from '../../services/planning/planRefinementService';
import type { PlanPayload } from '../../services/planning/planTypes';
import type { ResearchJobData } from '../../services/reasoning/researchOrchestratorTypes';
import { allowFallbackByRoleFromOverrides } from '../../services/reasoning/v2FallbackResolution';
import { normalizeRunOverrides } from '../../services/reasoning/researchOrchestratorNormalize';
import { researchQueue } from '../../queue/queues';
import {
  RESEARCH_JOB_RESUME_AFTER_PLAN,
  researchResumeJobId,
} from '../../queue/researchQueueJobs';
import { releaseHold } from '../../services/billing/walletReservations';
import { logger } from '../../utils/logger';

const router = Router();
router.use(requireAuth);

function ctxFromReq(req: Request): DossierAuthContext | null {
  const userId = req.auth?.userId;
  if (!userId) return null;
  return { userId, orgId: req.auth?.orgId ?? null };
}

/** Plan payloads are sensitive — never `io.emit` globally (PR #128 review). */
function emitPlan(io: SocketIOServer | undefined, room: string, event: string, data: unknown): void {
  if (!io) return;
  io.to(room).emit(event, data);
}

async function loadRunForPlanGate(
  runId: string,
  userId: string,
  orgId: string | null | undefined
): Promise<{
  id: string;
  status: string;
  resume_job_payload: unknown;
} | null> {
  try {
    // `await` so Postgres rejections (e.g. 42703 missing column) enter this `catch`
    // instead of rejecting the outer promise (Codex PR #128).
    return await queryOne(
      `SELECT id, status::text AS status, resume_job_payload
         FROM research_runs
        WHERE id = $1::uuid
          AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3) OR user_id IS NULL)`,
      [runId, userId, orgId ?? null]
    );
  } catch (e) {
    if ((e as { code?: string })?.code === '42703') {
      return await queryOne(
        `SELECT id, status::text AS status, resume_job_payload
           FROM research_runs
          WHERE id = $1::uuid
            AND (user_id = $2 OR (org_id IS NOT NULL AND org_id = $3) OR user_id IS NULL)`,
        [runId, userId, orgId ?? null]
      );
    }
    throw e;
  }
}

function isPlanPayload(v: unknown): v is PlanPayload {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  const o = v as Record<string, unknown>;
  return Boolean(o.intent && o.topicAnalysis && o.orchestrationProfile);
}

/** POST /api/runs/:runId/plan/refine */
router.post('/:runId/plan/refine', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runId = String(req.params.runId ?? '');
    const instruction =
      typeof (req.body as { refinementInstruction?: string })?.refinementInstruction === 'string'
        ? (req.body as { refinementInstruction: string }).refinementInstruction.trim()
        : '';
    if (!instruction) {
      res.status(400).json({ error: 'refinementInstruction is required' });
      return;
    }

    const run = await loadRunForPlanGate(runId, ctx.userId, ctx.orgId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.status !== 'plan_pending_confirmation') {
      res.status(400).json({ error: `Run is not awaiting plan confirmation (status=${run.status})` });
      return;
    }

    const gatePlan = await getGatePlanRowForRun(runId);
    if (!gatePlan?.id || !isPlanPayload(gatePlan.plan_payload)) {
      res.status(404).json({ error: 'No pending plan for this run' });
      return;
    }

    const payload =
      run.resume_job_payload && typeof run.resume_job_payload === 'object' && !Array.isArray(run.resume_job_payload)
        ? (run.resume_job_payload as ResearchJobData)
        : null;
    const overrides = normalizeRunOverrides(payload?.modelOverrides);
    const allowFallbackByRole = allowFallbackByRoleFromOverrides(overrides);
    let byokApiKeyOverride: string | undefined;
    if (payload?.creditChargeContext?.type === 'byok' && payload.creditChargeContext.userId) {
      const { getDecryptedKey } = await import('../../services/byok/keyVault');
      const key = await getDecryptedKey(payload.creditChargeContext.userId, 'openrouter');
      if (key) byokApiKeyOverride = key;
    }

    const queryText =
      (await queryOne<{ query: string }>(`SELECT query FROM research_runs WHERE id = $1::uuid`, [runId]))?.query ??
      '';

    const { revisedPlan, diffSummary, intentChange } = await refinePlan({
      currentPlan: gatePlan.plan_payload as PlanPayload,
      refinementInstruction: instruction,
      query: queryText,
      llmOpts: {
        engineVersion: payload?.engineVersion,
        researchObjective: payload?.researchObjective,
        allowFallbackByRole,
        byokApiKeyOverride,
      },
    });

    await appendPlanRevision({
      planId: gatePlan.id,
      runId,
      createdByUserId: ctx.userId,
      refinementPrompt: instruction,
      priorPayload: gatePlan.plan_payload as PlanPayload,
      newPayload: revisedPlan,
      diffSummary,
    });

    const io = req.app.get('io') as SocketIOServer | undefined;
    emitPlan(io, `job:${runId}`, 'research:plan_refined', {
      runId,
      planId: gatePlan.id,
      revisedPlan,
      diffSummary,
      intentChange,
      refinementRounds: gatePlan.refinement_rounds + 1,
    });
    io?.emit('runs:updated', {});

    try {
      await resetPlanConfirmationStreak(ctx.userId);
    } catch (streakErr) {
      logger.warn('plan_refine_streak_reset_failed', { runId, err: streakErr });
    }

    res.json({
      ok: true,
      planId: gatePlan.id,
      revisedPlan,
      diffSummary,
      intentChange,
      refinementRounds: gatePlan.refinement_rounds + 1,
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/runs/:runId/plan/confirm */
router.post('/:runId/plan/confirm', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runId = String(req.params.runId ?? '');
    const bodyPlanId =
      typeof (req.body as { planId?: string })?.planId === 'string'
        ? (req.body as { planId: string }).planId.trim()
        : '';

    const run = await loadRunForPlanGate(runId, ctx.userId, ctx.orgId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.status !== 'plan_pending_confirmation') {
      res.status(400).json({ error: `Run is not awaiting plan confirmation (status=${run.status})` });
      return;
    }

    const gatePlan = await getGatePlanRowForRun(runId);
    const effectivePlanId = bodyPlanId || gatePlan?.id;
    if (!effectivePlanId) {
      res.status(404).json({ error: 'No pending plan to confirm' });
      return;
    }

    const pendingMeta = await queryOne<{ refinement_rounds: number }>(
      `SELECT refinement_rounds FROM research_plans
        WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'pending_confirmation'`,
      [effectivePlanId, runId]
    );

    // Queue resume job before DB confirm so Redis hiccups never leave a confirmed plan
    // with no worker (Rule 13). `resumeAfterPlanConfirmation` requires `status='confirmed'`;
    // BullMQ retries cover the small window before confirm completes (PR #128 Codex).
    const resumeJid = researchResumeJobId(runId);
    const existingResume = await researchQueue.getJob(resumeJid);
    if (!existingResume) {
      try {
        await researchQueue.add(
          RESEARCH_JOB_RESUME_AFTER_PLAN,
          { runId, confirmedPlanId: effectivePlanId },
          {
            jobId: resumeJid,
            attempts: 8,
            backoff: { type: 'exponential', delay: 750 },
          }
        );
      } catch (queueErr) {
        const raced = await researchQueue.getJob(resumeJid);
        if (!raced) {
          logger.error('plan_confirm_queue_failed', { runId, planId: effectivePlanId, err: queueErr });
          res.status(503).json({
            error: 'Failed to queue pipeline resume',
            detail: 'No database changes were made; retry confirm when the queue is available.',
            planId: effectivePlanId,
          });
          return;
        }
      }
    }

    let confirmed = await confirmGatePlan({ planId: effectivePlanId, runId });
    if (!confirmed) {
      const already = await queryOne<{ id: string }>(
        `SELECT id FROM research_plans WHERE id = $1::uuid AND run_id = $2::uuid AND status = 'confirmed'`,
        [effectivePlanId, runId]
      );
      if (!already) {
        try {
          const j = await researchQueue.getJob(resumeJid);
          if (j) await j.remove();
        } catch (removeErr) {
          logger.warn('plan_confirm_rollback_job_remove', { runId, err: removeErr });
        }
        res.status(409).json({ error: 'Plan could not be confirmed (wrong state or plan id)' });
        return;
      }
    }

    try {
      await markRunRunningAfterPlanConfirm(runId);
    } catch (markErr) {
      logger.error('plan_confirm_mark_running_failed', { runId, err: markErr });
    }

    try {
      if (confirmed && pendingMeta && pendingMeta.refinement_rounds === 0) {
        await bumpPlanConfirmationStreakIfCleanConfirm(ctx.userId);
      } else if (confirmed && pendingMeta) {
        await resetPlanConfirmationStreak(ctx.userId);
      }
    } catch (streakErr) {
      logger.warn('plan_confirm_streak_update_failed', { runId, err: streakErr });
    }

    const io = req.app.get('io') as SocketIOServer | undefined;
    emitPlan(io, `job:${runId}`, 'research:plan_confirmed', { runId, planId: effectivePlanId });
    io?.emit('runs:updated', {});

    res.json({ ok: true, runId, planId: effectivePlanId, status: 'resume_queued' });
  } catch (e) {
    next(e);
  }
});

/** POST /api/runs/:runId/plan/cancel */
router.post('/:runId/plan/cancel', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runId = String(req.params.runId ?? '');

    const run = await loadRunForPlanGate(runId, ctx.userId, ctx.orgId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }
    if (run.status !== 'plan_pending_confirmation') {
      res.status(400).json({ error: `Run is not awaiting plan confirmation (status=${run.status})` });
      return;
    }

    const payload =
      run.resume_job_payload && typeof run.resume_job_payload === 'object' && !Array.isArray(run.resume_job_payload)
        ? (run.resume_job_payload as ResearchJobData)
        : null;
    if (payload?.creditChargeContext?.type === 'wallet' && payload.creditChargeContext.holdId && payload.creditChargeContext.userId) {
      try {
        await releaseHold(payload.creditChargeContext.holdId, payload.creditChargeContext.userId);
      } catch (relErr) {
        logger.warn('plan_gate_cancel_release_hold', { runId, err: relErr });
      }
    }

    try {
      const resumeJob = await researchQueue.getJob(researchResumeJobId(runId));
      if (resumeJob) {
        try {
          await resumeJob.remove();
        } catch (removeErr) {
          // BullMQ: locked / active job may throw — log and continue cancelling the run row.
          logger.warn('plan_gate_cancel_resume_job_remove', { runId, err: removeErr });
        }
      }
    } catch (e) {
      logger.warn('plan_gate_cancel_resume_job_lookup', { runId, err: e });
    }

    await cancelRunAtPlanGate(runId);

    try {
      await resetPlanConfirmationStreak(ctx.userId);
    } catch (streakErr) {
      logger.warn('plan_cancel_streak_reset_failed', { runId, err: streakErr });
    }

    const io = req.app.get('io') as SocketIOServer | undefined;
    emitPlan(io, `job:${runId}`, 'research:plan_cancelled', { runId });
    io?.emit('runs:updated', {});

    res.json({ ok: true, runId, status: 'cancelled' });
  } catch (e) {
    next(e);
  }
});

/** GET /api/runs/:runId/plan/revisions — plan refinement audit trail (Wave 5.4). */
router.get('/:runId/plan/revisions', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runId = String(req.params.runId ?? '');
    const dossier = await getDossierByRunId(runId, ctx);
    if (!dossier || dossier.runId !== runId) {
      res.status(404).json({ error: 'Dossier not found for this run' });
      return;
    }
    try {
      const revisions = await listPlanRevisionsForRun(runId);
      res.json({
        runId,
        revisions: revisions.map((r) => ({
          id: r.id,
          revisionNumber: r.revision_number,
          refinementPrompt: r.refinement_prompt,
          diffSummary: r.diff_summary,
          createdAt: r.created_at.toISOString(),
          createdBy: r.created_by,
          createdByEmail: r.created_by_email,
        })),
      });
    } catch (e) {
      if ((e as { code?: string })?.code === '42P01') {
        res.json({ runId, revisions: [] });
        return;
      }
      throw e;
    }
  } catch (e) {
    next(e);
  }
});

/** GET /api/runs/:runId/plan — latest plan from v_dossier */
router.get('/:runId/plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const runId = String(req.params.runId ?? '');
    const dossier = await getDossierByRunId(runId, ctx);
    if (!dossier || dossier.runId !== runId) {
      res.status(404).json({ error: 'Dossier not found for this run' });
      return;
    }
    res.json({
      runId: dossier.runId,
      runStatus: dossier.runStatus,
      plan: dossier.plan,
    });
  } catch (e) {
    next(e);
  }
});

export default router;
