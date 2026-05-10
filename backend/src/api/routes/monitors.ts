import { Router } from 'express';
import { requireAuth } from '../../middleware/clerkAuth';
import { logger } from '../../utils/logger';
import { config } from '../../config';
import { getStripeClient } from '../../services/billing/stripeClient';
import { query } from '../../db/pool';
import { getUserTier } from '../../services/tier/tierService';
import { TIER_RULES } from '../../config/tierRules';
import {
  cancelMonitor,
  listMonitorEvents,
  listMonitorsForReport,
  listMonitorsForUser,
  monitorPriceIdForKind,
  pauseMonitor,
  resumeMonitor,
  userCanAccessReportForMonitor,
  type MonitorKind,
} from '../../services/monitoring/parallelMonitorService';

/** Report-scoped checkout + listing — mount at `/api/reports` (paths: `/:reportId/monitors`). */
export const reportMonitorsRouter = Router();
reportMonitorsRouter.use(requireAuth);

/** User-level monitor CRUD — mount at `/api/monitors` (paths: `/`, `/:monitorId/events`, …). */
export const userMonitorsRouter = Router();
userMonitorsRouter.use(requireAuth);

function blockedTierForMonitorCheckout(tier: string): boolean {
  return tier === 'free_demo' || tier === 'anonymous';
}

const byReport = Router({ mergeParams: true });

byReport.post('/', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const reportId = String((req.params as { reportId?: string }).reportId ?? '').trim();
    const monitorKind = String((req.body as { monitorKind?: string })?.monitorKind ?? '').trim() as MonitorKind;
    if (!reportId || (monitorKind !== 'living_report' && monitorKind !== 'reverse_citation_watch')) {
      res.status(400).json({ error: 'reportId and monitorKind are required' });
      return;
    }

    const userTier = await getUserTier(userId);
    const tierName = userTier.tier;
    if (blockedTierForMonitorCheckout(tierName)) {
      res.status(403).json({ error: 'Upgrade required for Living Reports', upgradePath: '/app/billing' });
      return;
    }
    const rules = TIER_RULES[tierName] ?? TIER_RULES.free_demo;
    if (!rules.parallelSearch && tierName !== 'admin') {
      res.status(403).json({ error: 'Tier does not include Parallel-backed monitors', upgradePath: '/app/billing' });
      return;
    }

    const reportRows = await query<{ status: string }>('SELECT status FROM reports WHERE id=$1', [reportId]);
    if (reportRows.length === 0) {
      res.status(404).json({ error: 'Report not found' });
      return;
    }
    if (reportRows[0].status !== 'finalized') {
      res.status(400).json({ error: 'Monitors can only be attached to finalized reports' });
      return;
    }

    const allowed = await userCanAccessReportForMonitor(userId, reportId);
    if (!allowed) {
      res.status(403).json({ error: 'Forbidden' });
      return;
    }

    const priceId = monitorPriceIdForKind(monitorKind);
    if (!priceId) {
      res.status(503).json({ error: 'Stripe price not configured for this monitor product' });
      return;
    }

    const stripe = getStripeClient();
    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],
      success_url: config.stripe.successUrl,
      cancel_url: config.stripe.cancelUrl,
      metadata: {
        userId,
        purpose: 'living_report_monitor',
        report_id: reportId,
        monitor_kind: monitorKind,
      },
      subscription_data: {
        metadata: {
          user_id: userId,
          report_id: reportId,
          monitor_kind: monitorKind,
        },
      },
    });

    res.json({ checkoutUrl: session.url ?? null, sessionId: session.id });
  } catch (err) {
    next(err);
  }
});

byReport.get('/', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const reportId = String((req.params as { reportId?: string }).reportId ?? '').trim();
    if (!reportId) {
      res.status(400).json({ error: 'reportId required' });
      return;
    }
    const rows = await listMonitorsForReport(reportId, userId);
    res.json({ monitors: rows });
  } catch (err) {
    next(err);
  }
});

reportMonitorsRouter.use('/:reportId/monitors', byReport);

userMonitorsRouter.get('/', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rows = await listMonitorsForUser(userId);
    res.json({ monitors: rows });
  } catch (err) {
    next(err);
  }
});

userMonitorsRouter.get('/:monitorId/events', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    const rows = await listMonitorEvents(req.params.monitorId, userId);
    res.json({ events: rows });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'Forbidden' || msg === 'Monitor not found') {
      res.status(msg === 'Forbidden' ? 403 : 404).json({ error: msg });
      return;
    }
    next(err);
  }
});

userMonitorsRouter.post('/:monitorId/pause', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    await pauseMonitor(req.params.monitorId, userId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'Forbidden' || msg === 'Monitor not found') {
      res.status(msg === 'Forbidden' ? 403 : 404).json({ error: msg });
      return;
    }
    next(err);
  }
});

userMonitorsRouter.post('/:monitorId/resume', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    await resumeMonitor(req.params.monitorId, userId);
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'Forbidden' || msg === 'Monitor not found') {
      res.status(msg === 'Forbidden' ? 403 : 404).json({ error: msg });
      return;
    }
    next(err);
  }
});

userMonitorsRouter.delete('/:monitorId', async (req, res, next) => {
  try {
    const userId = req.auth?.userId;
    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const rows = await query<{ stripe_subscription_id: string | null }>(
      'SELECT stripe_subscription_id FROM report_monitors WHERE id=$1 AND user_id=$2 LIMIT 1',
      [req.params.monitorId, userId]
    );
    if (rows.length === 0) {
      res.status(404).json({ error: 'Monitor not found' });
      return;
    }

    const subId = rows[0].stripe_subscription_id;
    if (subId) {
      const stripe = getStripeClient();
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (stripeErr) {
        logger.warn('monitor_stripe_cancel_failed', {
          monitorId: req.params.monitorId,
          error: stripeErr instanceof Error ? stripeErr.message : 'Unknown',
        });
      }
    }

    await cancelMonitor(req.params.monitorId, userId, 'user_api_delete');
    res.json({ ok: true });
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg === 'Forbidden' || msg === 'Monitor not found') {
      res.status(msg === 'Forbidden' ? 403 : 404).json({ error: msg });
      return;
    }
    next(err);
  }
});

