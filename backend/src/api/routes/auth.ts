import { Router } from 'express';
import { query } from '../../db/pool';
import { requireAuth } from '../../middleware/clerkAuth';
import { config } from '../../config';
import {
  estimateAutoConfirmHitRate,
  getAccountPlanPreferences,
  upsertAccountPlanPreferences,
} from '../../services/planning/accountPreferencesService';
import {
  createSavedProfile,
  deleteSavedProfile,
  listSavedProfiles,
  isSavedProfileUuid,
} from '../../services/planning/savedOrchestrationProfileService';

const router = Router();

router.use(requireAuth);

// GET /api/auth/me — identity + admin flag (ADMIN_USER_IDS allowlist).
router.get('/me', (req, res) => {
  const userId = req.auth?.userId;
  if (!userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  const isAdmin = config.admin.userIds.includes(userId);
  res.json({ userId, isAdmin });
});

// GET /api/auth/plan-preferences — Wave 5.4 plan auto-confirm settings + optional preview.
router.get('/plan-preferences', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const prefs = await getAccountPlanPreferences(userId);
    const previewParam = typeof req.query.previewThreshold === 'string' ? req.query.previewThreshold : '';
    const previewRaw = previewParam ? Number(previewParam) : prefs.autoConfirmThreshold;
    const previewThreshold =
      typeof previewRaw === 'number' && Number.isFinite(previewRaw) ? Math.min(0.95, Math.max(0.7, previewRaw)) : prefs.autoConfirmThreshold;
    const preview = await estimateAutoConfirmHitRate(userId, previewThreshold);
    res.json({
      autoConfirmEnabled: prefs.autoConfirmEnabled,
      autoConfirmThreshold: prefs.autoConfirmThreshold,
      confirmedStreak: prefs.confirmedStreak,
      previewThreshold,
      previewSampleSize: preview.sampleSize,
      previewHitRate: preview.hitRate,
    });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/auth/plan-preferences — update auto-confirm toggle / threshold.
router.patch('/plan-preferences', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as { autoConfirmEnabled?: unknown; autoConfirmThreshold?: unknown };
    const patch: { autoConfirmEnabled?: boolean; autoConfirmThreshold?: number } = {};
    if (typeof body.autoConfirmEnabled === 'boolean') {
      patch.autoConfirmEnabled = body.autoConfirmEnabled;
    }
    if (typeof body.autoConfirmThreshold === 'number' && Number.isFinite(body.autoConfirmThreshold)) {
      patch.autoConfirmThreshold = body.autoConfirmThreshold;
    }
    let prefs;
    try {
      prefs = await upsertAccountPlanPreferences(userId, patch);
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 400) {
        res.status(400).json({ error: (err as Error).message });
        return;
      }
      throw err;
    }
    const preview = await estimateAutoConfirmHitRate(userId, prefs.autoConfirmThreshold);
    res.json({
      autoConfirmEnabled: prefs.autoConfirmEnabled,
      autoConfirmThreshold: prefs.autoConfirmThreshold,
      confirmedStreak: prefs.confirmedStreak,
      previewThreshold: prefs.autoConfirmThreshold,
      previewSampleSize: preview.sampleSize,
      previewHitRate: preview.hitRate,
    });
  } catch (e) {
    next(e);
  }
});

// GET /api/auth/saved-orchestration-profiles
router.get('/saved-orchestration-profiles', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const orgId = typeof req.auth?.orgId === 'string' && req.auth.orgId.trim() ? req.auth.orgId.trim() : null;
    const profiles = await listSavedProfiles(userId, orgId);
    res.json({ profiles });
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/saved-orchestration-profiles
router.post('/saved-orchestration-profiles', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const body = req.body as {
      name?: unknown;
      description?: unknown;
      baseIntent?: unknown;
      customizations?: unknown;
      isShared?: unknown;
    };
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) {
      res.status(400).json({ error: 'name is required' });
      return;
    }
    const baseIntent = typeof body.baseIntent === 'string' ? body.baseIntent.trim() : '';
    if (!baseIntent) {
      res.status(400).json({ error: 'baseIntent is required' });
      return;
    }
    const authOrgId =
      typeof req.auth?.orgId === 'string' && req.auth.orgId.trim() ? req.auth.orgId.trim() : null;
    const wantShared = body.isShared === true;
    if (wantShared && !authOrgId) {
      res.status(400).json({ error: 'Active organization context is required for org-shared profiles' });
      return;
    }
    const orgId = wantShared ? authOrgId : null;
    const description = typeof body.description === 'string' ? body.description : null;
    try {
      const row = await createSavedProfile({
        userId,
        orgId,
        name,
        description,
        baseIntent,
        customizations: body.customizations ?? {},
        isShared: wantShared,
      });
      res.status(201).json(row);
    } catch (err) {
      const code = (err as { statusCode?: number })?.statusCode;
      if (code === 403 || code === 400) {
        res.status(code).json({ error: (err as Error).message });
        return;
      }
      if ((err as { code?: string })?.code === '42P01') {
        res.status(503).json({ error: 'Saved profiles are not available yet (migration pending).' });
        return;
      }
      throw err;
    }
  } catch (e) {
    next(e);
  }
});

// DELETE /api/auth/saved-orchestration-profiles/:id
router.delete('/saved-orchestration-profiles/:id', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const id = String(req.params.id ?? '').trim();
    if (!id) {
      res.status(400).json({ error: 'Invalid profile id' });
      return;
    }
    if (!isSavedProfileUuid(id)) {
      res.status(400).json({ error: 'Invalid profile id' });
      return;
    }
    try {
      const ok = await deleteSavedProfile(userId, id);
      if (!ok) {
        res.status(404).json({ error: 'Profile not found' });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      if ((err as { code?: string })?.code === '42P01') {
        res.status(503).json({ error: 'Saved profiles are not available yet (migration pending).' });
        return;
      }
      throw err;
    }
  } catch (e) {
    next(e);
  }
});

// POST /api/auth/sync — idempotent local `users` sync for signed-in Clerk users (race with webhook).
// Uses ON CONFLICT DO UPDATE so email changes in Clerk propagate; still safe to call repeatedly.
router.post('/sync', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const email = (req.auth?.payload?.email as string | undefined) ?? null;

    await query(
      `INSERT INTO users (id, email)
       VALUES ($1, $2)
       ON CONFLICT (id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, users.email),
         updated_at = NOW()`,
      [userId, email]
    );

    res.json({ ok: true, userId });
  } catch (err) {
    next(err);
  }
});

export default router;
