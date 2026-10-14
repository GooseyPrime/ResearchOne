/**
 * Scite is optional enrichment, and what it does not say stays unknown
 * (14 Oct 2026). The earlier helpers called paths Scite never had and, on any
 * failure, reported a work as "active" with zero citations: a retracted paper
 * would have read as clean. These checks fail on that code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { config } from '../config';
import { parseSciteRecord, sciteBaseUrl, sciteEditorialKind, sciteRecordFor } from '../services/discovery/providers/sciteScholarly';
import { checkDois, type DoiHttp } from '../services/verification/doiResolve';

vi.mock('../queue/redis', () => ({ getRedis: () => ({ get: async () => null, set: async () => 'OK' }) }));

const saved = { key: config.discovery.sciteApiKey, base: config.discovery.sciteBaseUrl };
afterEach(() => {
  config.discovery.sciteApiKey = saved.key;
  config.discovery.sciteBaseUrl = saved.base;
});

describe('Scite records', () => {
  it('without a key nothing is asked and the answer is unknown, never "not retracted"', async () => {
    config.discovery.sciteApiKey = '';
    const get = vi.fn();
    const record = await sciteRecordFor('10.1/x', get);
    expect(record).toEqual({ known: false, doi: '10.1/x', reason: 'not_configured' });
    expect(get).not.toHaveBeenCalled();
    expect(sciteEditorialKind(record)).toBeNull();
  });

  it('asks GET /papers/{doi} at the API root with a Bearer key, even when an old setting ends in /v1', async () => {
    config.discovery.sciteApiKey = 'k';
    config.discovery.sciteBaseUrl = 'https://api.scite.ai/v1';
    expect(sciteBaseUrl()).toBe('https://api.scite.ai');
    const get = vi.fn(async (_url: string, _options: Record<string, unknown>) => ({ data: { retracted: false, editorialNotices: [], tally: { supporting: 3, contradicting: 1, mentioning: 9, total: 13 } } }));
    const record = await sciteRecordFor('10.1038/nature12373', get);
    expect(get.mock.calls[0][0]).toBe('https://api.scite.ai/papers/10.1038/nature12373');
    expect((get.mock.calls[0][1] as { headers: Record<string, string> }).headers.Authorization).toBe('Bearer k');
    expect(record).toMatchObject({ known: true, retracted: false, tally: { contradicting: 1, total: 13 } });
  });

  it('a refused, missing or failed lookup is unknown, with no counts at all', async () => {
    config.discovery.sciteApiKey = 'k';
    for (const [status, reason] of [[404, 'not_found'], [401, 'refused'], [429, 'refused'], [500, 'unavailable']] as const) {
      const get = vi.fn(async () => {
        throw Object.assign(new Error('x'), { response: { status } });
      });
      const record = await sciteRecordFor('10.1/x', get);
      expect(record).toEqual({ known: false, doi: '10.1/x', reason });
      expect(record).not.toHaveProperty('tally');
    }
  });

  it('reads a retraction from the flag or a notice; a record without a tally has no counts', () => {
    expect(sciteEditorialKind(parseSciteRecord('d', { retracted: true }))).toBe('retracted');
    expect(sciteEditorialKind(parseSciteRecord('d', { retracted: null, editorialNotices: [{ status: 'Retracted', doi: 'd' }] }))).toBe('retracted');
    expect(sciteEditorialKind(parseSciteRecord('d', { editorialNotices: [{ status: 'Correction', doi: 'd' }] }))).toBe('corrected');
    const plain = parseSciteRecord('d', { retracted: false });
    expect(sciteEditorialKind(plain)).toBeNull();
    expect(plain.known && plain.tally).toBeNull();
    expect(parseSciteRecord('d', 'not json')).toEqual({ known: false, doi: 'd', reason: 'unexpected_shape' });
  });
});

describe('the DOI check reads Scite after the publisher', () => {
  const resolving = (scite: DoiHttp['scite']): DoiHttp => ({ status: async () => 302, json: async () => ({ message: {} }), scite });

  it('records a retraction Scite knows of when the publisher record shows none', async () => {
    const checks = await checkDois(['10.1/r'], resolving(async (doi) => ({ known: true, doi, retracted: true, notices: [], tally: null })));
    expect(checks.get('10.1/r')?.notice).toEqual({ kind: 'retracted', text: 'Scite records that this work was retracted.' });
  });

  it('adds nothing when Scite does not know', async () => {
    const checks = await checkDois(['10.1/u'], resolving(async (doi) => ({ known: false, doi, reason: 'not_configured' })));
    expect(checks.get('10.1/u')?.notice).toBeNull();
    const failing = await checkDois(['10.1/f'], resolving(async () => { throw new Error('down'); }));
    expect(failing.get('10.1/f')?.notice).toBeNull();
  });
});
