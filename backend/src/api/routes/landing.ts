import { Router } from 'express';
import { adminQuery } from '../../db/pool';
import { logger } from '../../utils/logger';

const router = Router();

const VALID_PERSONAS = new Set(['osint', 'uap', 'academic', 'patent', 'default']);
const VALID_EVENT_TYPES = new Set(['view', 'cta_click']);

/**
 * POST /api/landing/persona-event
 *
 * Body: { persona: PersonaId, path: string, eventType?: 'view'|'cta_click' }
 *
 * No auth — landing analytics fires from anonymous visitors. Rate
 * limited via the existing express-rate-limit middleware applied at
 * mount time.
 *
 * Per Cursor rule 26 I-2: validates persona against an enum (no
 * free-text writes). Validates eventType against an enum. Truncates
 * path to 200 chars defensively.
 */
router.post('/persona-event', async (req, res, next) => {
  try {
    const body = req.body as Record<string, unknown>;
    const persona = String(body.persona ?? '').toLowerCase();
    const path = String(body.path ?? '/').slice(0, 200);
    const eventType = String(body.eventType ?? 'view').toLowerCase();

    if (!VALID_PERSONAS.has(persona)) {
      // Silent reject — do not echo the bad value, do not 400 — we
      // do not want to give attackers a probe surface for our enum.
      // The frontend should not send invalid values; if it does, log
      // at DEBUG and return 204 so the request silently no-ops.
      logger.debug('persona-event: invalid persona, dropping', { persona });
      res.status(204).end();
      return;
    }
    if (!VALID_EVENT_TYPES.has(eventType)) {
      res.status(204).end();
      return;
    }

    await adminQuery(
      `INSERT INTO landing_persona_events (persona, path, event_type)
       VALUES ($1, $2, $3)`,
      [persona, path, eventType]
    );

    res.status(204).end();
  } catch (err) {
    // 42P01 deploy-skew tolerance — return 204 so the frontend doesn't
    // see an error.
    if ((err as { code?: string })?.code === '42P01') {
      res.status(204).end();
      return;
    }
    next(err);
  }
});

export default router;
