/**
 * Living Reports / Parallel Monitor — Work Order T.
 *
 * Parallel webhook payload & signature: verify live docs at https://parallel.ai/docs
 * before changing verification or parsing. Current assumptions (configure via env):
 * - Delivery is JSON with stable provider event id in `id` or `event_id`.
 * - Remote monitor id is `parallel_monitor_id` or `monitor_id`.
 * - HMAC-SHA256 hex digest of the raw request body, compared via header `X-Parallel-Signature`.
 */

import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../config';
import { query } from '../../db/pool';
import { logger } from '../../utils/logger';
import type { RevisionTriggerSource } from '../reasoning/reportRevisionService';

export type MonitorKind = 'living_report' | 'reverse_citation_watch';

export interface MonitorRow {
  id: string;
  report_id: string;
  user_id: string;
  org_id: string | null;
  monitor_kind: MonitorKind;
  parallel_monitor_id: string;
  query_def: Record<string, unknown>;
  status: string;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
}

/** Same text must be passed to `createReportRevision` when finishing the queued job (request row already exists). */
export const MONITOR_REVISION_REQUEST = `Parallel Monitor detected a material change in monitored sources.
Re-evaluate this published report under ResearchOne PolicyOne: preserve anomalies,
apply reasoning-first discipline, and update sections where new evidence warrants revision.
Do not bypass Skeptic / internal challenger stages — same pipeline as a user-initiated revision.`;

export function verifyParallelWebhookSignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
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

export function parseParallelWebhookPayload(body: unknown): {
  parallelMonitorId: string;
  eventId: string;
  raw: Record<string, unknown>;
} | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as Record<string, unknown>;
  const parallelMonitorId = String(o.parallel_monitor_id ?? o.monitor_id ?? '').trim();
  const eventId = String(o.id ?? o.event_id ?? '').trim();
  if (!parallelMonitorId || !eventId) return null;
  return { parallelMonitorId, eventId, raw: o };
}

export async function userCanAccessReportForMonitor(userId: string, reportId: string): Promise<boolean> {
  const rows = await query<{ run_id: string | null }>('SELECT run_id FROM reports WHERE id=$1', [reportId]);
  const runId = rows[0]?.run_id;
  if (!runId) return false;
  const runIdText = String(runId);

  const wallet = await query<{ n: string }>(
    `SELECT '1' AS n FROM wallet_holds WHERE user_id=$1 AND run_id=$2 LIMIT 1`,
    [userId, runIdText]
  );
  if (wallet.length > 0) return true;

  const audit = await query<{ n: string }>(
    `SELECT '1' AS n FROM ingestion_audit_log WHERE user_id=$1 AND run_id=$2 LIMIT 1`,
    [userId, runIdText]
  );
  return audit.length > 0;
}

export async function tryClaimParallelWebhookEvent(
  monitorId: string,
  webhookEventId: string,
  payload: Record<string, unknown>
): Promise<boolean> {
  const inserted = await query<{ id: string }>(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, webhook_event_id, payload)
     VALUES ($1, 'webhook_received', $2, $3::jsonb)
     ON CONFLICT (webhook_event_id) WHERE webhook_event_id IS NOT NULL DO NOTHING
     RETURNING id`,
    [monitorId, webhookEventId, JSON.stringify(payload)]
  );
  return inserted.length > 0;
}

export async function releaseParallelWebhookClaim(webhookEventId: string): Promise<void> {
  await query(`DELETE FROM report_monitor_events WHERE webhook_event_id=$1 AND event_kind='webhook_received'`, [
    webhookEventId,
  ]);
}

export async function recordLivingRevisionOutcome(args: {
  monitorId: string;
  revisionId: string;
  webhookEventId: string;
}): Promise<void> {
  await query(`UPDATE report_monitors SET last_revision_id=$1, last_event_at=NOW() WHERE id=$2`, [
    args.revisionId,
    args.monitorId,
  ]);
  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, revision_id, payload)
     VALUES ($1, 'revision_completed', $2, $3::jsonb)`,
    [args.monitorId, args.revisionId, JSON.stringify({ webhook_event_id: args.webhookEventId })]
  );
}

export async function recordLivingRevisionJobFailed(args: {
  monitorId: string;
  revisionRequestId: string;
  webhookEventId: string;
  errorMessage: string;
}): Promise<void> {
  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, payload)
     VALUES ($1, 'revision_failed', $2::jsonb)`,
    [
      args.monitorId,
      JSON.stringify({
        revision_request_id: args.revisionRequestId,
        webhook_event_id: args.webhookEventId,
        error: args.errorMessage,
      }),
    ]
  );
}

export interface MonitorEventRow {
  id: string;
  event_kind: string;
  webhook_event_id: string | null;
  payload: Record<string, unknown> | null;
  revision_id: string | null;
  created_at: string;
}

export async function listMonitorEvents(monitorId: string, userId: string, limit = 80): Promise<MonitorEventRow[]> {
  await assertMonitorCaller(monitorId, userId);
  return query<MonitorEventRow>(
    `SELECT id, event_kind, webhook_event_id, payload, revision_id, created_at
     FROM report_monitor_events WHERE monitor_id=$1 ORDER BY created_at DESC LIMIT $2`,
    [monitorId, limit]
  );
}

function revisionTriggerForMonitorKind(kind: MonitorKind): RevisionTriggerSource {
  return kind === 'reverse_citation_watch' ? 'reverse_citation_watch' : 'parallel_monitor';
}

export async function enqueueLivingRevisionFromWebhook(args: {
  monitor: MonitorRow;
  webhookEventId: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  const triggeredBy = revisionTriggerForMonitorKind(args.monitor.monitor_kind);
  const { createRevisionRequest } = await import('../reasoning/reportRevisionService');
  const { requestId } = await createRevisionRequest({
    reportId: args.monitor.report_id,
    requestText: MONITOR_REVISION_REQUEST,
    rationale: 'Automatic revision triggered by Parallel Monitor webhook.',
    initiatedBy: 'parallel_monitor',
    initiatedByType: 'system',
    revisionTriggeredBy: triggeredBy,
  });

  const { livingReportRevisionQueue } = await import('../../queue/queues');
  await livingReportRevisionQueue.add(
    'revision',
    {
      monitorId: args.monitor.id,
      reportId: args.monitor.report_id,
      revisionRequestId: requestId,
      webhookEventId: args.webhookEventId,
      triggeredBy,
    },
    { jobId: args.webhookEventId, removeOnComplete: 50, removeOnFail: 100 }
  );

  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, payload)
     VALUES ($1, 'revision_enqueued', $2::jsonb)`,
    [
      args.monitor.id,
      JSON.stringify({ revision_request_id: requestId, webhook_event_id: args.webhookEventId }),
    ]
  );

  await query(`UPDATE report_monitors SET last_event_at=NOW() WHERE id=$1`, [args.monitor.id]);
}

export async function findMonitorByParallelId(parallelMonitorId: string): Promise<MonitorRow | null> {
  const rows = await query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE parallel_monitor_id=$1 AND status='active' LIMIT 1`,
    [parallelMonitorId]
  );
  return rows[0] ?? null;
}

export async function findMonitorByStripeSubscriptionId(subscriptionId: string): Promise<MonitorRow | null> {
  const rows = await query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE stripe_subscription_id=$1 LIMIT 1`,
    [subscriptionId]
  );
  return rows[0] ?? null;
}

async function createRemoteParallelMonitor(queryDef: Record<string, unknown>): Promise<string> {
  const apiKey = config.parallelMonitor.apiKey?.trim();
  const base = config.parallelMonitor.baseUrl;
  if (!apiKey) {
    logger.warn('parallel_monitor_no_api_key_using_stub_id');
    return `stub_${crypto.randomUUID()}`;
  }
  /** POST path is provisional — confirm against Parallel Monitor API docs before production. */
  const url = `${base}/monitors`;
  const res = await axios.post<{ id?: string; monitor_id?: string }>(url, queryDef, {
    timeout: 30_000,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
  const id = res.data?.id ?? res.data?.monitor_id;
  if (!id || typeof id !== 'string') {
    throw new Error('Parallel Monitor API returned no monitor id');
  }
  return id;
}

async function patchRemoteParallelMonitor(parallelMonitorId: string, body: Record<string, unknown>): Promise<void> {
  if (parallelMonitorId.startsWith('stub_')) return;
  const apiKey = config.parallelMonitor.apiKey?.trim();
  if (!apiKey) return;
  const base = config.parallelMonitor.baseUrl;
  const url = `${base}/monitors/${encodeURIComponent(parallelMonitorId)}`;
  await axios.patch(url, body, {
    timeout: 30_000,
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
  });
}

async function deleteRemoteParallelMonitor(parallelMonitorId: string): Promise<void> {
  if (parallelMonitorId.startsWith('stub_')) return;
  const apiKey = config.parallelMonitor.apiKey?.trim();
  if (!apiKey) return;
  const base = config.parallelMonitor.baseUrl;
  const url = `${base}/monitors/${encodeURIComponent(parallelMonitorId)}`;
  await axios.delete(url, { timeout: 30_000, headers: { Authorization: `Bearer ${apiKey}` } });
}

function buildQueryDef(args: {
  reportId: string;
  falsification_criteria: string | null;
  citationDois: string[];
  monitorKind: MonitorKind;
}): Record<string, unknown> {
  if (args.monitorKind === 'reverse_citation_watch') {
    return {
      kind: 'reverse_citation_watch',
      report_id: args.reportId,
      dois: args.citationDois.slice(0, 50),
    };
  }
  return {
    kind: 'living_report',
    report_id: args.reportId,
    falsification_criteria: args.falsification_criteria ?? '',
    top_citation_dois: args.citationDois.slice(0, 25),
  };
}

export async function registerMonitor(args: {
  reportId: string;
  userId: string;
  orgId?: string | null;
  monitorKind: MonitorKind;
  stripeSubscriptionId: string;
  stripeSubscriptionItemId?: string | null;
}): Promise<{ monitorId: string; parallelMonitorId: string; status: string }> {
  const existing = await query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE report_id=$1 AND monitor_kind=$2 LIMIT 1`,
    [args.reportId, args.monitorKind]
  );
  if (existing[0]) {
    const row = existing[0];
    return { monitorId: row.id, parallelMonitorId: row.parallel_monitor_id, status: row.status };
  }

  const reportRows = await query<{ falsification_criteria: string | null }>(
    'SELECT falsification_criteria FROM reports WHERE id=$1',
    [args.reportId]
  );
  const falsification_criteria = reportRows[0]?.falsification_criteria ?? null;

  const doiRows = await query<{ doi: string }>(
    `SELECT DISTINCT trim(coalesce(s.metadata->>'doi', s.metadata->>'DOI', '')) AS doi
     FROM report_citations rc
     JOIN sources s ON s.id = rc.source_id
     WHERE rc.report_id=$1
       AND length(trim(coalesce(s.metadata->>'doi', s.metadata->>'DOI', ''))) > 4
     LIMIT 60`,
    [args.reportId]
  );
  const citationDois = doiRows.map((r) => r.doi).filter(Boolean);

  const queryDef = buildQueryDef({
    reportId: args.reportId,
    falsification_criteria,
    citationDois,
    monitorKind: args.monitorKind,
  });

  const parallelMonitorId = await createRemoteParallelMonitor(queryDef);

  const inserted = await query<{ id: string }>(
    `INSERT INTO report_monitors (
       report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
       stripe_subscription_id, stripe_subscription_item_id
     ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, 'active', $7, $8)
     RETURNING id`,
    [
      args.reportId,
      args.userId,
      args.orgId ?? null,
      args.monitorKind,
      parallelMonitorId,
      JSON.stringify(queryDef),
      args.stripeSubscriptionId,
      args.stripeSubscriptionItemId ?? null,
    ]
  );

  const monitorId = inserted[0]?.id;
  if (!monitorId) throw new Error('Failed to insert report_monitors row');

  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, payload)
     VALUES ($1, 'subscription_active', $2::jsonb)`,
    [monitorId, JSON.stringify({ stripe_subscription_id: args.stripeSubscriptionId })]
  );

  return { monitorId, parallelMonitorId, status: 'active' };
}

async function assertMonitorCaller(monitorId: string, userId: string): Promise<MonitorRow> {
  const rows = await query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE id=$1 LIMIT 1`,
    [monitorId]
  );
  const row = rows[0];
  if (!row) throw new Error('Monitor not found');
  if (row.user_id !== userId) throw new Error('Forbidden');
  return row;
}

export async function pauseMonitor(monitorId: string, userId: string): Promise<void> {
  const row = await assertMonitorCaller(monitorId, userId);
  await patchRemoteParallelMonitor(row.parallel_monitor_id, { status: 'paused' });
  await query(`UPDATE report_monitors SET status='paused', paused_at=NOW(), last_event_at=NOW() WHERE id=$1`, [
    monitorId,
  ]);
  await query(`INSERT INTO report_monitor_events (monitor_id, event_kind) VALUES ($1, 'monitor_paused')`, [monitorId]);
}

export async function resumeMonitor(monitorId: string, userId: string): Promise<void> {
  const row = await assertMonitorCaller(monitorId, userId);
  await patchRemoteParallelMonitor(row.parallel_monitor_id, { status: 'active' });
  await query(
    `UPDATE report_monitors SET status='active', paused_at=NULL, last_event_at=NOW() WHERE id=$1`,
    [monitorId]
  );
  await query(`INSERT INTO report_monitor_events (monitor_id, event_kind) VALUES ($1, 'monitor_resumed')`, [monitorId]);
}

export async function cancelMonitor(monitorId: string, userId: string, reason: string): Promise<void> {
  const row = await assertMonitorCaller(monitorId, userId);
  await deleteRemoteParallelMonitor(row.parallel_monitor_id);
  await query(
    `UPDATE report_monitors SET status='cancelled', cancelled_at=NOW(), last_event_at=NOW() WHERE id=$1`,
    [monitorId]
  );
  await query(`INSERT INTO report_monitor_events (monitor_id, event_kind, payload) VALUES ($1, 'monitor_cancelled', $2::jsonb)`, [
    monitorId,
    JSON.stringify({ reason }),
  ]);
}

export async function cancelMonitorByStripeSubscription(subscriptionId: string): Promise<void> {
  const row = await findMonitorByStripeSubscriptionId(subscriptionId);
  if (!row || row.status === 'cancelled') return;
  await deleteRemoteParallelMonitor(row.parallel_monitor_id);
  await query(
    `UPDATE report_monitors SET status='cancelled', cancelled_at=NOW(), last_event_at=NOW() WHERE id=$1`,
    [row.id]
  );
  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, payload) VALUES ($1, 'subscription_cancelled', $2::jsonb)`,
    [row.id, JSON.stringify({ stripe_subscription_id: subscriptionId })]
  );
}

export async function recordSubscriptionPastDueForMonitor(subscriptionId: string): Promise<void> {
  const row = await findMonitorByStripeSubscriptionId(subscriptionId);
  if (!row) return;
  await query(
    `INSERT INTO report_monitor_events (monitor_id, event_kind, payload) VALUES ($1, 'subscription_past_due', $2::jsonb)`,
    [row.id, JSON.stringify({ stripe_subscription_id: subscriptionId })]
  );
}

export async function listMonitorsForReport(reportId: string, userId: string): Promise<MonitorRow[]> {
  return query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE report_id=$1 AND user_id=$2 ORDER BY created_at DESC`,
    [reportId, userId]
  );
}

export async function listMonitorsForUser(userId: string): Promise<MonitorRow[]> {
  return query<MonitorRow>(
    `SELECT id, report_id, user_id, org_id, monitor_kind, parallel_monitor_id, query_def, status,
            stripe_subscription_id, stripe_subscription_item_id
     FROM report_monitors WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [userId]
  );
}

export function monitorPriceIdForKind(kind: MonitorKind): string {
  return kind === 'reverse_citation_watch'
    ? config.stripe.priceIds.reverseCitationWatchMonthly
    : config.stripe.priceIds.livingReportMonthly;
}

export function subscriptionHasLivingReportsPrice(
  subscriptionItems: Array<{ price?: { id?: string | null } | null }>
): boolean {
  const living = config.stripe.priceIds.livingReportMonthly;
  const rcw = config.stripe.priceIds.reverseCitationWatchMonthly;
  return subscriptionItems.some((it) => {
    const pid = it.price?.id;
    return Boolean(pid && (pid === living || pid === rcw));
  });
}

export function monitorKindFromStripePriceId(priceId: string): MonitorKind | null {
  if (priceId === config.stripe.priceIds.reverseCitationWatchMonthly) return 'reverse_citation_watch';
  if (priceId === config.stripe.priceIds.livingReportMonthly) return 'living_report';
  return null;
}
