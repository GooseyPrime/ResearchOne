import { Router, type Request, type Response, type NextFunction } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import {
  getDossierById,
  getDossierPlan,
  getDossierReportHistory,
  getDossierReportLink,
  getDossierRequest,
  getDossierSpinoffs,
  getDossierStats,
  listDossiers,
} from '../../services/research/dossierReadService';
import type { DossierAuthContext } from '../../types/dossier';
import {
  dossierIdParamSchema,
  dossierListQuerySchema,
} from '../../schemas/dossierSchemas';

const router = Router();
router.use(requireAuth);

function ctxFromReq(req: Request): DossierAuthContext | null {
  const userId = req.auth?.userId;
  if (!userId) return null;
  return { userId, orgId: req.auth?.orgId ?? null };
}

function parseDossierId(raw: string | undefined): { ok: true; id: string } | { ok: false } {
  const id = typeof raw === 'string' ? raw : '';
  const parsed = dossierIdParamSchema.safeParse({ id });
  if (!parsed.success) return { ok: false };
  return { ok: true, id: parsed.data.id };
}

router.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const q = dossierListQuerySchema.safeParse(req.query);
    if (!q.success) {
      res.status(400).json({ error: 'Invalid query', detail: q.error.flatten() });
      return;
    }
    const { page, pageSize, intent, status, dateFrom, dateTo, sortBy } = q.data;

    const result = await listDossiers(
      { page, pageSize, intent, status, dateFrom, dateTo, sortBy },
      ctx,
    );
    res.json(result);
  } catch (e) {
    next(e);
  }
});


router.get('/:id/request', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const section = await getDossierRequest(id, ctx);
    if (!section) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(section);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/plan', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const section = await getDossierPlan(id, ctx);
    if (!section) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(section);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/report', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const link = await getDossierReportLink(id, ctx);
    if (!link) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(link);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/stats', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const stats = await getDossierStats(id, ctx);
    if (!stats) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(stats);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/report-history', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const history = await getDossierReportHistory(id, ctx);
    if (!history) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(history);
  } catch (e) {
    next(e);
  }
});

router.get('/:id/spinoffs', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const spinoffs = await getDossierSpinoffs(id, ctx);
    if (!spinoffs) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(spinoffs);
  } catch (e) {
    next(e);
  }
});


router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const ctx = ctxFromReq(req);
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const parsed = parseDossierId(String(req.params.id));
    if (!parsed.ok) {
      res.status(400).json({ error: 'Invalid dossier id' });
      return;
    }
    const { id } = parsed;
    const dossier = await getDossierById(id, ctx);
    if (!dossier) {
      res.status(404).json({ error: 'Dossier not found' });
      return;
    }
    res.json(dossier);
  } catch (e) {
    next(e);
  }
});

export default router;
