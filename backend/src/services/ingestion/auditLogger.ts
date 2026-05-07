import { query } from '../../db/pool';
import { logger } from '../../utils/logger';

export type AuditEventType =
  | 'eligibility_check'
  | 'sanitization_started'
  | 'sanitization_completed'
  | 'intellme_request_sent'
  | 'intellme_response_received'
  | 'intellme_deduplicated'
  | 'intellme_error'
  | 'deletion_requested'
  | 'deletion_completed'
  | 'deletion_error'
  | 'consent_changed'
  | 'per_run_opt_out';

export async function writeAuditLog(
  runId: string,
  userId: string,
  eventType: AuditEventType,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await query(
      `INSERT INTO ingestion_audit_log (run_id, user_id, event_type, metadata)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [runId, userId, eventType, JSON.stringify(metadata)]
    );
  } catch (err: unknown) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42P01') {
      logger.warn('ingestion_audit_log table not found — migration not applied', { runId, eventType });
      return;
    }
    throw err;
  }
}
