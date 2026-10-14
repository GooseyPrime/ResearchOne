/**
 * Parallel Monitor webhook (Work Order T; contract checked 14 Oct 2026).
 *
 * Deliveries are signed per Standard Webhooks
 * (https://docs.parallel.ai/resources/webhook-setup): `webhook-id`,
 * `webhook-timestamp` and `webhook-signature` headers, verified in
 * `verifyStandardWebhook`. The body is `{ type, timestamp, data: { monitor_id, event, metadata } }`
 * (https://docs.parallel.ai/monitor-api/monitor-webhooks).
 *
 * `webhook-id` is the delivery's id: a repeat of it is acknowledged and not
 * acted on again. Only `monitor.event.detected` starts a revision; a failed
 * execution is recorded on the monitor and starts nothing.
 */

import { Router, Request, Response } from 'express';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import {
  findMonitorByParallelId,
  tryClaimParallelWebhookEvent,
  releaseParallelWebhookClaim,
  enqueueLivingRevisionFromWebhook,
} from '../../services/monitoring/parallelMonitorService';
import { parseMonitorWebhook, verifyStandardWebhook } from '../../services/monitoring/parallelMonitorClient';

const router = Router();

function header(req: Request, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}

router.post('/', async (req: Request, res: Response) => {
  const secret = config.parallelMonitor.webhookSecret?.trim();
  if (!secret) {
    res.status(503).json({ error: 'Parallel webhook not configured' });
    return;
  }

  // The raw body is what was signed; a body that was not kept raw cannot be verified.
  if (!Buffer.isBuffer(req.body)) {
    res.status(400).json({ error: 'Invalid signature' });
    return;
  }
  const raw = req.body;
  const webhookId = header(req, 'webhook-id');
  if (
    !verifyStandardWebhook({
      rawBody: raw,
      webhookId,
      webhookTimestamp: header(req, 'webhook-timestamp'),
      webhookSignature: header(req, 'webhook-signature'),
      secret,
    })
  ) {
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

  const parsed = parseMonitorWebhook(parsedJson);
  if (!parsed || !webhookId) {
    res.status(400).json({ error: 'Missing monitor id or event type' });
    return;
  }

  const monitor = await findMonitorByParallelId(parsed.remoteMonitorId);
  if (!monitor) {
    // A monitor we no longer run (paused, cancelled, replaced). Acknowledged so Parallel stops retrying.
    logger.info('parallel_monitor_webhook_unknown_monitor', { type: parsed.type });
    res.status(200).json({ ok: true, ignored: true });
    return;
  }

  const claimed = await tryClaimParallelWebhookEvent(monitor.id, webhookId, { type: parsed.type, data: parsed.data });
  if (!claimed) {
    res.status(200).json({ ok: true, replayed: true });
    return;
  }

  if (parsed.type !== 'monitor.event.detected') {
    // Recorded by the claim above; nothing to revise.
    res.status(200).json({ ok: true, recorded: true });
    return;
  }

  try {
    await enqueueLivingRevisionFromWebhook({ monitor, webhookEventId: webhookId, payload: { type: parsed.type, data: parsed.data } });
  } catch (err) {
    await releaseParallelWebhookClaim(webhookId);
    logger.error('parallel_monitor_webhook_enqueue_failed', { error: err instanceof Error ? err.name : 'Unknown' });
    res.status(500).json({ error: 'Enqueue failed' });
    return;
  }

  res.status(200).json({ ok: true });
});

export default router;
