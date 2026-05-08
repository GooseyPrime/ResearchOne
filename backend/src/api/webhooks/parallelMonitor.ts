/**
 * Parallel Monitor webhook — Work Order T.
 *
 * Payload shape & signature scheme: verify against https://parallel.ai/docs
 * ( assumptions documented in `parallelMonitorService.ts` ).
 */

import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  verifyParallelWebhookSignature,
  parseParallelWebhookPayload,
  findMonitorByParallelId,
  tryClaimParallelWebhookEvent,
  releaseParallelWebhookClaim,
  enqueueLivingRevisionFromWebhook,
} from '../../services/monitoring/parallelMonitorService';

const router = Router();

router.post('/', async (req: Request, res: Response) => {
  const secret = config.parallelMonitor.webhookSecret?.trim();
  if (!secret) {
    res.status(503).json({ error: 'Parallel webhook not configured' });
    return;
  }

  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from(JSON.stringify(req.body ?? {}));
  const sigHdr = req.headers['x-parallel-signature'];
  const sigStr = Array.isArray(sigHdr) ? sigHdr[0] : sigHdr;

  if (!verifyParallelWebhookSignature(raw, typeof sigStr === 'string' ? sigStr : undefined, secret)) {
    logger.warn('parallel_monitor_webhook_signature_invalid');
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw.toString('utf8'));
  } catch {
    res.status(400).json({ error: 'Invalid JSON body' });
    return;
  }

  const parsed = parseParallelWebhookPayload(parsedJson);
  if (!parsed) {
    res.status(400).json({ error: 'Missing parallel_monitor_id or event id' });
    return;
  }

  const monitor = await findMonitorByParallelId(parsed.parallelMonitorId);
  if (!monitor) {
    logger.warn('parallel_monitor_webhook_unknown_monitor', { parallelMonitorId: parsed.parallelMonitorId });
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const claimed = await tryClaimParallelWebhookEvent(monitor.id, parsed.eventId, parsed.raw);
  if (!claimed) {
    res.status(200).json({ ok: true, replayed: true });
    return;
  }

  try {
    await enqueueLivingRevisionFromWebhook({
      monitor,
      webhookEventId: parsed.eventId,
      payload: parsed.raw,
    });
  } catch (err) {
    await releaseParallelWebhookClaim(parsed.eventId);
    logger.error('parallel_monitor_webhook_enqueue_failed', {
      error: err instanceof Error ? err.message : 'Unknown',
      eventId: parsed.eventId,
    });
    res.status(500).json({ error: 'Enqueue failed' });
    return;
  }

  res.status(200).json({ ok: true });
});

export default router;
