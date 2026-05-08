import { describe, expect, it } from 'vitest';
import crypto from 'crypto';
import { verifyParallelWebhookSignature, parseParallelWebhookPayload } from '../parallelMonitorService';

describe('parallelMonitorService', () => {
  it('verifyParallelWebhookSignature accepts raw hex digest matching HMAC-SHA256 of body', () => {
    const secret = 'test_secret';
    const body = Buffer.from('{"id":"evt_1","parallel_monitor_id":"mon_a"}', 'utf8');
    const hex = crypto.createHmac('sha256', secret).update(body).digest('hex');
    expect(verifyParallelWebhookSignature(body, hex, secret)).toBe(true);
    expect(verifyParallelWebhookSignature(body, `sha256=${hex}`, secret)).toBe(true);
  });

  it('verifyParallelWebhookSignature rejects wrong digest', () => {
    const secret = 'test_secret';
    const body = Buffer.from('{}', 'utf8');
    expect(verifyParallelWebhookSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('parseParallelWebhookPayload reads parallel_monitor_id and id', () => {
    const parsed = parseParallelWebhookPayload({
      id: 'evt_42',
      parallel_monitor_id: 'pm_123',
      foo: 1,
    });
    expect(parsed).toMatchObject({
      parallelMonitorId: 'pm_123',
      eventId: 'evt_42',
    });
    expect(parsed?.raw.id).toBe('evt_42');
  });

  it('parseParallelWebhookPayload accepts monitor_id alias', () => {
    const parsed = parseParallelWebhookPayload({
      event_id: 'e9',
      monitor_id: 'm2',
    });
    expect(parsed?.parallelMonitorId).toBe('m2');
    expect(parsed?.eventId).toBe('e9');
  });

  it('parseParallelWebhookPayload returns null when ids missing', () => {
    expect(parseParallelWebhookPayload({ id: 'only_event' })).toBeNull();
    expect(parseParallelWebhookPayload(null)).toBeNull();
  });
});
