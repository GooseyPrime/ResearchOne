/**
 * BugNote inbound webhook — Phase A stub.
 *
 * Signature header and digest scheme are **unverified** placeholders until
 * BugNote workspace docs are provided. See `docs/integrations/bugnote-scope.md`.
 */

import crypto from 'crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';

const router = Router();

/** Placeholder contract: HMAC-SHA256 hex of raw body; optional `sha256=` prefix. */
export function verifyBugNoteWebhookSignature(
  rawBody: Buffer,
  signatureHeader: string | undefined,
  secret: string
): boolean {
  if (!signatureHeader?.trim() || !secret) return false;
  const expectedHex = crypto.createHmac('sha256', secret).update(rawBody).digest('hex');
  let sig = signatureHeader.trim().toLowerCase();
  if (sig.startsWith('sha256=')) sig = sig.slice(7).trim();
  try {
    const a = Buffer.from(sig, 'utf8');
    const b = Buffer.from(expectedHex, 'utf8');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

function summarizePayload(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== 'object') {
    return { shape: typeof body };
  }
  const o = body as Record<string, unknown>;
  return {
    eventType: o.type ?? o.event ?? null,
    eventId: o.id ?? o.event_id ?? null,
    keys: Object.keys(o).slice(0, 12),
  };
}

router.post('/', (req: Request, res: Response) => {
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(JSON.stringify(req.body ?? {}));

  const secret = config.bugnote.webhookSecret?.trim();
  if (!secret) {
    if (config.nodeEnv === 'production') {
      logger.warn('bugnote_webhook_secret_missing');
      res.status(503).json({ error: 'Webhook not configured' });
      return;
    }
  } else {
    const sigHdr = req.headers['x-bugnote-signature'];
    const sigStr = Array.isArray(sigHdr) ? sigHdr[0] : sigHdr;
    if (!verifyBugNoteWebhookSignature(raw, typeof sigStr === 'string' ? sigStr : undefined, secret)) {
      logger.warn('bugnote_webhook_signature_invalid');
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const summary = summarizePayload(parsed);
  logger.info('bugnote_webhook_received', summary);

  res.status(200).json({ ok: true });
});

export default router;
