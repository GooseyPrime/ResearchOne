/**
 * The Parallel Monitor API, as documented (14 Oct 2026):
 *   - create: `POST {base}/monitors` (https://docs.parallel.ai/api-reference/monitor/create-monitor)
 *     body `{ type: 'event_stream', frequency, settings: { query }, webhook: { url, event_types }, metadata }`,
 *     answer `{ monitor_id, status: 'active' | 'cancelled', ... }`;
 *   - cancel: `POST {base}/monitors/{id}/cancel` (cancel-monitor). There is no
 *     pause: a paused living report has its remote monitor cancelled, and a new
 *     one is created when it is turned back on;
 *   - auth: `x-api-key` on every request;
 *   - webhooks: Standard Webhooks signatures (https://docs.parallel.ai/resources/webhook-setup),
 *     verified in `verifyStandardWebhook`.
 *
 * Settings: `PARALLEL_MONITOR_API_KEY` (falls back to `PARALLEL_API_KEY`),
 * `PARALLEL_MONITOR_WEBHOOK_URL` (where Parallel posts events) and
 * `PARALLEL_MONITOR_WEBHOOK_SECRET` (the account webhook secret, Settings →
 * Webhooks in Parallel). Without all three no monitor is created: a monitor
 * that cannot report back is not a working monitor. There are no stand-in ids.
 */
import crypto from 'crypto';
import axios from 'axios';
import { config } from '../../config';
import { logger } from '../../utils/logger';
import { safeFailureRecord } from '../discovery/providers/providerHttp';

export const MONITOR_FREQUENCY = '1d';
export const MONITOR_EVENT_TYPES = ['monitor.event.detected', 'monitor.execution.failed'] as const;
/** Standard Webhooks: a delivery older or newer than this is refused. */
export const WEBHOOK_TOLERANCE_SECONDS = 5 * 60;

/** What a person is told when monitoring is not available on this server. Which setting is missing is for administrators (health, logs). */
export const MONITORING_UNAVAILABLE = {
  error: 'Report monitoring is not available yet',
  code: 'MONITORING_NOT_CONFIGURED',
  detail: 'Living Reports and Reverse-Citation Watch cannot be started right now. Nothing was charged.',
};

export type MonitorProviderProblem = 'not_configured' | 'refused' | 'unexpected_answer' | 'unavailable';

export class MonitorProviderError extends Error {
  readonly problem: MonitorProviderProblem;
  /** Settings that are missing, by name only. */
  readonly missing: string[];
  constructor(problem: MonitorProviderProblem, message: string, missing: string[] = []) {
    super(message);
    this.name = 'MonitorProviderError';
    this.problem = problem;
    this.missing = missing;
  }
}

/** The settings a monitor needs that are not set, by name. Empty when monitors can be created. */
export function missingMonitorSettings(): string[] {
  const missing: string[] = [];
  if (!config.parallelMonitor.apiKey?.trim()) missing.push('PARALLEL_MONITOR_API_KEY (or PARALLEL_API_KEY)');
  if (!/^https:\/\//i.test(config.parallelMonitor.webhookUrl ?? '')) missing.push('PARALLEL_MONITOR_WEBHOOK_URL');
  if (!config.parallelMonitor.webhookSecret?.trim()) missing.push('PARALLEL_MONITOR_WEBHOOK_SECRET');
  return missing;
}

/** A row written before 14 Oct 2026 with a stand-in id: nothing was ever created at Parallel. */
export function isStandInMonitorId(id: string | null | undefined): boolean {
  return typeof id === 'string' && id.startsWith('stub_');
}

type Poster = (url: string, body: unknown, options: Record<string, unknown>) => Promise<{ data?: unknown }>;
const defaultPost: Poster = (url, body, options) => axios.post(url, body, options);

function headers(): Record<string, string> {
  return { 'Content-Type': 'application/json', 'x-api-key': config.parallelMonitor.apiKey.trim() };
}

function asProviderError(err: unknown, action: string): MonitorProviderError {
  if (err instanceof MonitorProviderError) return err;
  const status = (err as { response?: { status?: number } })?.response?.status;
  logger.warn(`[parallel-monitor] ${action} failed`, safeFailureRecord(err));
  if (status === 401 || status === 402 || status === 403 || status === 429) return new MonitorProviderError('refused', `Parallel refused to ${action} (status ${status}).`);
  return new MonitorProviderError('unavailable', `Parallel could not ${action}.`);
}

/**
 * Create a monitor at Parallel and return its id. Throws `MonitorProviderError`
 * when a setting is missing, Parallel refuses, or the answer is not an active
 * monitor; nothing is created on our side in any of those cases.
 */
export async function createRemoteMonitor(args: { query: string; metadata: Record<string, string> }, post: Poster = defaultPost): Promise<string> {
  const missing = missingMonitorSettings();
  if (missing.length > 0) {
    throw new MonitorProviderError('not_configured', `Report monitoring is not set up on this server: ${missing.join(', ')} not set.`, missing);
  }
  const query = args.query.trim();
  if (!query) throw new MonitorProviderError('unexpected_answer', 'A monitor needs something to watch.');
  // Parallel limits metadata keys to 16 characters and values to 512.
  const metadata = Object.fromEntries(Object.entries(args.metadata).map(([k, v]) => [k.slice(0, 16), String(v).slice(0, 512)]));
  let data: unknown;
  try {
    ({ data } = await post(
      `${config.parallelMonitor.baseUrl}/monitors`,
      {
        type: 'event_stream',
        frequency: MONITOR_FREQUENCY,
        settings: { query },
        webhook: { url: config.parallelMonitor.webhookUrl, event_types: [...MONITOR_EVENT_TYPES] },
        metadata,
      },
      { headers: headers(), timeout: 30_000 }
    ));
  } catch (err) {
    throw asProviderError(err, 'create the monitor');
  }
  const body = data as { monitor_id?: unknown; status?: unknown } | undefined;
  if (typeof body?.monitor_id !== 'string' || !body.monitor_id.trim() || body.status !== 'active') {
    throw new MonitorProviderError('unexpected_answer', 'Parallel did not answer with an active monitor.');
  }
  return body.monitor_id;
}

/**
 * Cancel a monitor at Parallel. A stand-in id has nothing to cancel. A monitor
 * Parallel no longer has (404) is already gone. Any other failure throws, so a
 * caller never records a cancellation Parallel did not make.
 */
export async function cancelRemoteMonitor(remoteId: string, post: Poster = defaultPost): Promise<void> {
  if (!remoteId || isStandInMonitorId(remoteId)) return;
  if (!config.parallelMonitor.apiKey?.trim()) {
    throw new MonitorProviderError('not_configured', 'The Parallel key is not set, so the monitor could not be cancelled at Parallel.', ['PARALLEL_MONITOR_API_KEY (or PARALLEL_API_KEY)']);
  }
  try {
    await post(`${config.parallelMonitor.baseUrl}/monitors/${encodeURIComponent(remoteId)}/cancel`, {}, { headers: headers(), timeout: 30_000 });
  } catch (err) {
    if ((err as { response?: { status?: number } })?.response?.status === 404) return;
    throw asProviderError(err, 'cancel the monitor');
  }
}

/** The signing key from a Standard Webhooks secret: `whsec_` removed, the rest Base64-decoded. */
function signingKey(secret: string): Buffer {
  return Buffer.from(secret.startsWith('whsec_') ? secret.slice('whsec_'.length) : secret, 'base64');
}

/**
 * Standard Webhooks verification: HMAC-SHA256 over
 * `<webhook-id>.<webhook-timestamp>.<raw body>`, standard Base64, compared
 * with each `v1,<sig>` entry of `webhook-signature`; the timestamp must be
 * within `WEBHOOK_TOLERANCE_SECONDS` of now.
 */
export function verifyStandardWebhook(args: {
  rawBody: Buffer;
  webhookId: string | undefined;
  webhookTimestamp: string | undefined;
  webhookSignature: string | undefined;
  secret: string;
  nowSeconds?: number;
}): boolean {
  const { webhookId, webhookTimestamp, webhookSignature, secret } = args;
  if (!webhookId || !webhookTimestamp || !webhookSignature || !secret) return false;
  if (!/^\d+$/.test(webhookTimestamp)) return false;
  const now = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - Number(webhookTimestamp)) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = crypto
    .createHmac('sha256', signingKey(secret))
    .update(`${webhookId}.${webhookTimestamp}.${args.rawBody.toString('utf8')}`)
    .digest();
  for (const entry of webhookSignature.split(' ')) {
    const [version, signature] = entry.split(',', 2);
    if (version !== 'v1' || !signature) continue;
    let given: Buffer;
    try {
      given = Buffer.from(signature, 'base64');
    } catch {
      continue;
    }
    if (given.length === expected.length && crypto.timingSafeEqual(given, expected)) return true;
  }
  return false;
}

/** A Monitor webhook body: `{ type, timestamp, data: { monitor_id, event, metadata } }`. */
export function parseMonitorWebhook(body: unknown): { type: string; remoteMonitorId: string; data: Record<string, unknown> } | null {
  if (!body || typeof body !== 'object') return null;
  const o = body as { type?: unknown; data?: unknown };
  const data = o.data as Record<string, unknown> | undefined;
  if (typeof o.type !== 'string' || !data || typeof data.monitor_id !== 'string' || !data.monitor_id.trim()) return null;
  return { type: o.type, remoteMonitorId: data.monitor_id, data };
}
