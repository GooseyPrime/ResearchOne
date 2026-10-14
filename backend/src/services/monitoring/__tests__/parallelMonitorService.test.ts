/**
 * The Parallel Monitor client against Parallel's documented contract
 * (14 Oct 2026): `x-api-key`, `POST /v1/monitors` with `type`, `frequency`,
 * `settings.query`, `webhook` and `metadata`, `POST /v1/monitors/{id}/cancel`,
 * and Standard Webhooks signatures. A monitor is never "created" without
 * Parallel answering with an active one: there are no stand-in ids.
 */
import crypto from 'crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { config } from '../../../config';
import {
  MonitorProviderError,
  cancelRemoteMonitor,
  createRemoteMonitor,
  isStandInMonitorId,
  missingMonitorSettings,
  parseMonitorWebhook,
  verifyStandardWebhook,
} from '../parallelMonitorClient';
import { monitorQueryFor } from '../parallelMonitorService';

const saved = { ...config.parallelMonitor };
const KEY = 'pm-key-never-logged';
const RAW_SECRET = Buffer.from('a-signing-key-of-some-length-32b').toString('base64');
const SECRET = `whsec_${RAW_SECRET}`;

beforeEach(() => {
  config.parallelMonitor.apiKey = KEY;
  config.parallelMonitor.webhookUrl = 'https://api.example.org/api/webhooks/parallel-monitor';
  config.parallelMonitor.webhookSecret = SECRET;
  config.parallelMonitor.baseUrl = 'https://api.parallel.ai/v1';
});
afterEach(() => {
  Object.assign(config.parallelMonitor, saved);
});

function sign(id: string, timestamp: string, body: string, secret = RAW_SECRET): string {
  return crypto.createHmac('sha256', Buffer.from(secret, 'base64')).update(`${id}.${timestamp}.${body}`).digest('base64');
}

describe('creating a monitor', () => {
  it('posts the documented body with x-api-key and returns the monitor id', async () => {
    const post = vi.fn(async () => ({ data: { monitor_id: 'mon_123', status: 'active' } }));
    const id = await createRemoteMonitor({ query: 'New publications about solid state batteries', metadata: { report_id: 'r1', kind: 'living_report' } }, post);
    expect(id).toBe('mon_123');
    const [url, body, options] = post.mock.calls[0] as unknown as [string, Record<string, unknown>, { headers: Record<string, string> }];
    expect(url).toBe('https://api.parallel.ai/v1/monitors');
    expect(options.headers['x-api-key']).toBe(KEY);
    expect(options.headers.Authorization).toBeUndefined();
    expect(body).toEqual({
      type: 'event_stream',
      frequency: '1d',
      settings: { query: 'New publications about solid state batteries' },
      webhook: { url: 'https://api.example.org/api/webhooks/parallel-monitor', event_types: ['monitor.event.detected', 'monitor.execution.failed'] },
      metadata: { report_id: 'r1', kind: 'living_report' },
    });
  });

  it('with a setting missing, asks nothing, makes no stand-in id, and names what is missing', async () => {
    config.parallelMonitor.apiKey = '';
    config.parallelMonitor.webhookUrl = '';
    const post = vi.fn();
    const err = await createRemoteMonitor({ query: 'q', metadata: {} }, post).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MonitorProviderError);
    expect((err as MonitorProviderError).problem).toBe('not_configured');
    expect((err as MonitorProviderError).missing).toEqual(['PARALLEL_MONITOR_API_KEY (or PARALLEL_API_KEY)', 'PARALLEL_MONITOR_WEBHOOK_URL']);
    expect(post).not.toHaveBeenCalled();
    expect(missingMonitorSettings()).toContain('PARALLEL_MONITOR_WEBHOOK_URL');
  });

  it('a refusal, or an answer that is not an active monitor, is an error, never an id', async () => {
    const refused = vi.fn(async () => {
      throw Object.assign(new Error('x'), { response: { status: 402 } });
    });
    expect(((await createRemoteMonitor({ query: 'q', metadata: {} }, refused).catch((e: unknown) => e)) as MonitorProviderError).problem).toBe('refused');
    for (const data of [{ id: 'old_shape' }, { monitor_id: 'm', status: 'cancelled' }, '<html></html>']) {
      const post = vi.fn(async () => ({ data }));
      expect(((await createRemoteMonitor({ query: 'q', metadata: {} }, post).catch((e: unknown) => e)) as MonitorProviderError).problem).toBe('unexpected_answer');
    }
  });
});

describe('cancelling a monitor', () => {
  it('posts /monitors/{id}/cancel; a stand-in id and a 404 need nothing more; other failures throw', async () => {
    const post = vi.fn(async (_url: string, _body: unknown, _options: Record<string, unknown>) => ({ data: { status: 'cancelled' } }));
    await cancelRemoteMonitor('mon_9', post);
    expect(post.mock.calls[0][0]).toBe('https://api.parallel.ai/v1/monitors/mon_9/cancel');
    await cancelRemoteMonitor('stub_123', post);
    expect(post).toHaveBeenCalledTimes(1);
    expect(isStandInMonitorId('stub_123')).toBe(true);
    await expect(cancelRemoteMonitor('mon_gone', vi.fn(async () => { throw Object.assign(new Error('x'), { response: { status: 404 } }); }))).resolves.toBeUndefined();
    await expect(cancelRemoteMonitor('mon_x', vi.fn(async () => { throw Object.assign(new Error('x'), { response: { status: 500 } }); }))).rejects.toBeInstanceOf(MonitorProviderError);
  });
});

describe('webhook signatures (Standard Webhooks)', () => {
  const body = JSON.stringify({ type: 'monitor.event.detected', timestamp: '2026-10-14T10:00:00Z', data: { monitor_id: 'mon_123', event: { event_group_id: 'eg1' } } });
  const now = 1_760_000_000;
  const ts = String(now);

  it('accepts a signature over id.timestamp.body with the whsec_ secret, including one of several during rotation', () => {
    const sig = sign('msg_1', ts, body);
    expect(verifyStandardWebhook({ rawBody: Buffer.from(body), webhookId: 'msg_1', webhookTimestamp: ts, webhookSignature: `v1,${sig}`, secret: SECRET, nowSeconds: now })).toBe(true);
    expect(verifyStandardWebhook({ rawBody: Buffer.from(body), webhookId: 'msg_1', webhookTimestamp: ts, webhookSignature: `v1,AAAA v1,${sig}`, secret: SECRET, nowSeconds: now })).toBe(true);
  });

  it('refuses a tampered body, a changed id, a stale or future timestamp, the old hex scheme, and a missing header', () => {
    const sig = sign('msg_1', ts, body);
    const base = { webhookId: 'msg_1', webhookTimestamp: ts, webhookSignature: `v1,${sig}`, secret: SECRET, nowSeconds: now };
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body.replace('mon_123', 'mon_999')) })).toBe(false);
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), webhookId: 'msg_2' })).toBe(false);
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), nowSeconds: now + 3600 })).toBe(false);
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), nowSeconds: now - 3600 })).toBe(false);
    const hex = crypto.createHmac('sha256', SECRET).update(body).digest('hex');
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), webhookSignature: hex })).toBe(false);
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), webhookSignature: undefined })).toBe(false);
    expect(verifyStandardWebhook({ ...base, rawBody: Buffer.from(body), webhookSignature: `v1,${sign('msg_1', ts, body, Buffer.from('another-key').toString('base64'))}` })).toBe(false);
  });

  it('reads the documented body: type and data.monitor_id', () => {
    expect(parseMonitorWebhook(JSON.parse(body))).toMatchObject({ type: 'monitor.event.detected', remoteMonitorId: 'mon_123' });
    expect(parseMonitorWebhook({ id: 'evt', parallel_monitor_id: 'pm' })).toBeNull();
    expect(parseMonitorWebhook(null)).toBeNull();
  });
});

describe('what a monitor watches', () => {
  it('a living report watches its subject and cited works; a reverse-citation watch, works citing them', () => {
    expect(monitorQueryFor({ kind: 'living_report', top_citation_dois: ['10.1/a'] }, 'Home battery storage costs')).toBe(
      'New publications, retractions, corrections or official updates about: Home battery storage costs. Including any retraction or correction of: 10.1/a'
    );
    expect(monitorQueryFor({ kind: 'reverse_citation_watch', dois: ['10.1/a', '10.1/b'] }, 'x')).toBe('New publications that cite any of these works: 10.1/a, 10.1/b');
  });
});
