/**
 * Shared webhook idempotency and dispatch module.
 *
 * Extracts the idempotency-key core into a reusable module.
 * Each webhook provider (Stripe, etc.) handles its own signature verification,
 * then uses this module for idempotency checking and event dispatch.
 *
 * Per Work Order F: "a fake noop provider can be wired in tests in <30 LOC"
 */

import { query } from '../../../db/pool';
import { logger } from '../../../utils/logger';

export interface IdempotencyResult {
  isNew: boolean;
  alreadyProcessed: boolean;
}

/**
 * Records a webhook event in the database for idempotency checking.
 * Returns { isNew: true, alreadyProcessed: false } if this is a new event.
 * Returns { isNew: false, alreadyProcessed: true } if already processed.
 * Returns { isNew: false, alreadyProcessed: false } if recorded but not processed (can retry).
 */
export async function checkAndRecordWebhookEvent(
  eventId: string,
  eventType: string,
  payload: unknown
): Promise<IdempotencyResult> {
  const existing = await query<{ processed_at: string | null }>(
    'SELECT processed_at FROM stripe_webhook_events WHERE stripe_event_id = $1',
    [eventId]
  );

  if (existing.length > 0) {
    const alreadyProcessed = existing[0].processed_at !== null;
    return { isNew: false, alreadyProcessed };
  }

  await query(
    `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, payload, processed_at)
     VALUES ($1, $2, $3, NULL)
     ON CONFLICT (stripe_event_id) DO NOTHING`,
    [eventId, eventType, JSON.stringify(payload)]
  );

  return { isNew: true, alreadyProcessed: false };
}

/**
 * Marks a webhook event as successfully processed in the database.
 */
export async function markWebhookEventProcessed(eventId: string): Promise<void> {
  await query(
    'UPDATE stripe_webhook_events SET processed_at = NOW() WHERE stripe_event_id = $1',
    [eventId]
  );
}

/**
 * Records a processing error for a webhook event.
 */
export async function recordWebhookProcessingError(eventId: string, error: string): Promise<void> {
  try {
    await query(
      'UPDATE stripe_webhook_events SET processing_error = $2 WHERE stripe_event_id = $1',
      [eventId, error]
    );
  } catch {
    logger.warn('Failed to record webhook processing error', { eventId, error });
  }
}

export type WebhookEventHandler<T> = (data: T, eventId: string) => Promise<void>;

/**
 * Dispatches a webhook event to the appropriate handler with idempotency.
 * Returns true if the event was processed (or already processed), false on error.
 */
export async function dispatchWebhookEvent<T>(
  eventId: string,
  eventType: string,
  data: T,
  rawPayload: unknown,
  handlers: Record<string, WebhookEventHandler<T>>,
  providerName: string
): Promise<{ status: 'processed' | 'already_processed' | 'unhandled' | 'error'; error?: string }> {
  const { isNew, alreadyProcessed } = await checkAndRecordWebhookEvent(eventId, eventType, rawPayload);

  if (alreadyProcessed) {
    logger.info(`${providerName}_webhook_already_processed`, { eventId, eventType });
    return { status: 'already_processed' };
  }

  const handler = handlers[eventType];
  if (!handler) {
    await markWebhookEventProcessed(eventId);
    logger.info(`${providerName}_webhook_unhandled_type`, { eventId, eventType });
    return { status: 'unhandled' };
  }

  try {
    await handler(data, eventId);
    await markWebhookEventProcessed(eventId);
    logger.info(`${providerName}_webhook_processed`, { eventId, eventType });
    return { status: 'processed' };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown processing error';
    logger.error(`${providerName}_webhook_processing_failed`, { eventId, eventType, error: message });
    await recordWebhookProcessingError(eventId, message);
    return { status: 'error', error: message };
  }
}
