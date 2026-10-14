/**
 * Each search adapter against its provider's documented contract (14 Oct 2026):
 * the request it sends (address, auth header, body, limits), how it reads the
 * answer, and what it does with an answer that is not the contract (an HTML
 * page with status 200, a missing list). A failure is reported through
 * `onFailure`, never returned as an empty success, and the log carries the
 * kind of failure and its status only, never the key, headers or body.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const axiosMock = vi.hoisted(() => ({ post: vi.fn(), get: vi.fn() }));
vi.mock('axios', () => ({ default: axiosMock, ...axiosMock }));
const logs = vi.hoisted(() => ({ entries: [] as unknown[][] }));
vi.mock('../../../../utils/logger', () => {
  const record = (...args: unknown[]) => logs.entries.push(args);
  return { logger: { warn: record, error: record, info: record, debug: record } };
});

import { config } from '../../../../config';
import { PROVIDER_NOT_CONFIGURED } from '../../providerTypes';
import { ParallelSearchProvider, parallelSearchBody } from '../parallelSearch';
import { TavilySearchProvider } from '../tavilySearch';
import { BraveSearchProvider, braveSearchParams } from '../braveSearch';
import { UsptoSearchProvider, USPTO_SEARCH_URL } from '../usptoSearch';
import { OpenAlexSearchProvider } from '../openAlexSearch';
import { GenericWebSearchProvider } from '../genericWebSearch';
import { PROVIDER_REGISTRY } from '../../providerRegistry';

const KEY = 'test-key-that-must-never-be-logged';
const HTML_PAGE = '<!doctype html><html><body>PatentsView has moved</body></html>';
const saved = { ...config.discovery };

beforeEach(() => {
  axiosMock.post.mockReset();
  axiosMock.get.mockReset();
  logs.entries = [];
});
afterEach(() => {
  Object.assign(config.discovery, saved);
});

function failures() {
  const seen: unknown[] = [];
  return { seen, onFailure: (f: unknown) => seen.push(f) };
}

function axiosError(status: number) {
  return Object.assign(new Error(`Request failed with status code ${status}`), {
    name: 'AxiosError',
    code: 'ERR_BAD_REQUEST',
    response: { status, data: { secret: 'body' } },
    config: { headers: { 'x-api-key': KEY, Authorization: `Bearer ${KEY}` } },
  });
}

function logsNeverCarryTheKey() {
  expect(JSON.stringify(logs.entries)).not.toContain(KEY);
  expect(JSON.stringify(logs.entries)).not.toContain('secret');
}

describe('Parallel search', () => {
  it('posts /v1/search with x-api-key, objective, search_queries and advanced_settings.max_results', async () => {
    config.discovery.parallelApiKey = KEY;
    axiosMock.post.mockResolvedValue({
      data: {
        search_id: 's1',
        session_id: 'x',
        results: [
          { url: 'https://a.example/1', title: 'A', publish_date: '2026-01-02', excerpts: ['first', 'second'] },
          { url: 'https://b.example/2', title: null, publish_date: null, excerpts: [] },
          { title: 'no url', excerpts: ['x'] },
        ],
      },
    });
    const out = await new ParallelSearchProvider().search({ text: 'Market size of home battery storage in Germany', maxResults: 50 });
    const [url, body, options] = axiosMock.post.mock.calls[0];
    expect(url).toBe('https://api.parallel.ai/v1/search');
    expect(options.headers['x-api-key']).toBe(KEY);
    expect(options.headers.Authorization).toBeUndefined();
    expect(Object.keys(body).sort()).toEqual(['advanced_settings', 'objective', 'search_queries']);
    expect(body.objective).toBe('Market size of home battery storage in Germany');
    expect(body.search_queries[0].split(' ').length).toBeLessThanOrEqual(6);
    expect(body.advanced_settings).toEqual({ max_results: 20 });
    expect(out.map((r) => r.url)).toEqual(['https://a.example/1', 'https://b.example/2']);
    expect(out[0].snippet).toBe('first\n\nsecond');
    expect(out[0].bibliographic?.publishedAt).toBe('2026-01-02');
    expect(out[1].title).toBe('https://b.example/2');
  });

  it('never sends the fields the API refuses', () => {
    const body = parallelSearchBody({ text: 'q', tags: ['t'], preferredSourceTypes: ['news'] });
    expect(body).not.toHaveProperty('query');
    expect(body).not.toHaveProperty('tags');
    expect(body).not.toHaveProperty('source_types');
    expect(body).not.toHaveProperty('max_results');
  });

  it('a 200 page that is not JSON, or a body with no results list, is a failure', async () => {
    config.discovery.parallelApiKey = KEY;
    for (const data of [HTML_PAGE, { search_id: 's' }]) {
      axiosMock.post.mockResolvedValueOnce({ data });
      const f = failures();
      expect(await new ParallelSearchProvider().search({ text: 'q', onFailure: f.onFailure })).toEqual([]);
      expect(f.seen).toHaveLength(1);
    }
  });

  it('a refusal is reported, and the log carries only its kind and status', async () => {
    config.discovery.parallelApiKey = KEY;
    axiosMock.post.mockRejectedValue(axiosError(429));
    const f = failures();
    await new ParallelSearchProvider().search({ text: 'q', onFailure: f.onFailure });
    expect(f.seen).toHaveLength(1);
    expect(logs.entries.at(-1)?.[1]).toEqual({ error_kind: 'ERR_BAD_REQUEST', http_status: 429 });
    logsNeverCarryTheKey();
  });

  it('with no key, no request is made and it says it is not configured', async () => {
    config.discovery.parallelApiKey = '';
    const f = failures();
    await new ParallelSearchProvider().search({ text: 'q', onFailure: f.onFailure });
    expect(axiosMock.post).not.toHaveBeenCalled();
    expect(f.seen).toEqual([PROVIDER_NOT_CONFIGURED]);
  });
});

describe('Tavily', () => {
  it('sends the key as a Bearer header, never in the body, and asks for at most 20 results', async () => {
    config.discovery.tavilyApiKey = KEY;
    config.discovery.maxResults = 25;
    axiosMock.post.mockResolvedValue({ data: { results: [{ url: 'https://t.example', title: 'T', content: 'c', score: 0.7 }] } });
    const out = await new TavilySearchProvider().search({ text: 'q' });
    const [, body, options] = axiosMock.post.mock.calls[0];
    expect(options.headers.Authorization).toBe(`Bearer ${KEY}`);
    expect(body).not.toHaveProperty('api_key');
    expect(body.max_results).toBe(20);
    expect(out[0]).toMatchObject({ url: 'https://t.example', snippet: 'c', score: 0.7 });
  });

  it('a non-JSON 200 answer is a failure, and the log never carries the key', async () => {
    config.discovery.tavilyApiKey = KEY;
    axiosMock.post.mockResolvedValue({ data: HTML_PAGE });
    const f = failures();
    expect(await new TavilySearchProvider().search({ text: 'q', onFailure: f.onFailure })).toEqual([]);
    expect(f.seen).toHaveLength(1);
    logsNeverCarryTheKey();
  });
});

describe('Brave', () => {
  it('asks for 1 to 20 results and cuts the query to 600 characters and 75 words', () => {
    config.discovery.maxResults = 25;
    expect(braveSearchParams({ text: 'q' }).count).toBe(20);
    expect(braveSearchParams({ text: 'q', maxResults: 0 }).count).toBe(1);
    const long = Array.from({ length: 120 }, (_, i) => `word${i}`).join(' ');
    const { q } = braveSearchParams({ text: long });
    expect(q.split(' ')).toHaveLength(75);
    expect(braveSearchParams({ text: 'x'.repeat(5) + ' ' + 'y'.repeat(700) }).q.length).toBeLessThanOrEqual(600);
  });

  it('reads web.results, treats a missing web block as no results, and a non-JSON page as a failure', async () => {
    config.discovery.providerApiKey = KEY;
    axiosMock.get.mockResolvedValueOnce({ data: { web: { results: [{ url: 'https://b.example', title: 'B', description: 'd' }] } } });
    expect((await new BraveSearchProvider().search({ text: 'q' }))[0]).toMatchObject({ url: 'https://b.example', snippet: 'd' });
    expect(axiosMock.get.mock.calls[0][1].headers['X-Subscription-Token']).toBe(KEY);
    axiosMock.get.mockResolvedValueOnce({ data: { type: 'search' } });
    expect(await new BraveSearchProvider().search({ text: 'q' })).toEqual([]);
    axiosMock.get.mockResolvedValueOnce({ data: HTML_PAGE });
    const f = failures();
    await new BraveSearchProvider().search({ text: 'q', onFailure: f.onFailure });
    expect(f.seen).toHaveLength(1);
  });
});

describe('USPTO Open Data Portal', () => {
  it('is not configured, and makes no request, without USPTO_API_KEY', async () => {
    config.discovery.usptoApiKey = '';
    expect(PROVIDER_REGISTRY.uspto.isConfigured()).toBe(false);
    expect(PROVIDER_REGISTRY.uspto.needs).toEqual(['USPTO_API_KEY']);
    const f = failures();
    expect(await new UsptoSearchProvider().search({ text: 'solid state battery', onFailure: f.onFailure })).toEqual([]);
    expect(axiosMock.get).not.toHaveBeenCalled();
    expect(axiosMock.post).not.toHaveBeenCalled();
    expect(f.seen).toEqual([PROVIDER_NOT_CONFIGURED]);
  });

  it('searches applications with X-API-KEY, does not follow a redirect, and links granted patents and publications', async () => {
    config.discovery.usptoApiKey = KEY;
    expect(PROVIDER_REGISTRY.uspto.isConfigured()).toBe(true);
    axiosMock.get.mockResolvedValue({
      data: {
        count: 3,
        patentFileWrapperDataBag: [
          { applicationNumberText: '16123456', applicationMetaData: { inventionTitle: 'Solid state battery', patentNumber: '11234567', grantDate: '2022-02-01', applicationStatusDescriptionText: 'Patented Case' } },
          { applicationNumberText: '17000001', applicationMetaData: { inventionTitle: 'Battery separator', earliestPublicationNumber: 'US20230012345A1', filingDate: '2021-05-05' } },
          { applicationNumberText: '17000002', applicationMetaData: { inventionTitle: 'No public page yet' } },
        ],
      },
    });
    const out = await new UsptoSearchProvider().search({ text: 'solid state battery', maxResults: 100 });
    const [url, options] = axiosMock.get.mock.calls[0];
    expect(url).toBe(USPTO_SEARCH_URL);
    expect(url).not.toContain('patentsview');
    expect(options.headers['X-API-KEY']).toBe(KEY);
    expect(options.maxRedirects).toBe(0);
    expect(options.params).toMatchObject({ q: 'solid state battery', limit: 25 });
    expect(out.map((r) => r.url)).toEqual(['https://patents.google.com/patent/US11234567', 'https://patents.google.com/patent/US20230012345A1']);
    expect(out[0].snippet).toBe('US patent 11234567; granted 2022-02-01; Patented Case');
  });

  it('the retired API page (HTML, status 200) and an unexpected body are failures, not empty successes', async () => {
    config.discovery.usptoApiKey = KEY;
    for (const data of [HTML_PAGE, { patents: [] }]) {
      axiosMock.get.mockResolvedValueOnce({ data });
      const f = failures();
      expect(await new UsptoSearchProvider().search({ text: 'q', onFailure: f.onFailure })).toEqual([]);
      expect(f.seen).toHaveLength(1);
    }
    logsNeverCarryTheKey();
  });
});

describe('OpenAlex', () => {
  it('works without a key and sends api_key only when one is set', async () => {
    axiosMock.get.mockResolvedValue({ data: { results: [{ id: 'https://openalex.org/W1', display_name: 'Work' }] } });
    config.discovery.openAlexApiKey = '';
    expect(PROVIDER_REGISTRY.openalex.isConfigured()).toBe(true);
    await new OpenAlexSearchProvider().search({ text: 'q' });
    expect(axiosMock.get.mock.calls[0][1].params).not.toHaveProperty('api_key');
    config.discovery.openAlexApiKey = KEY;
    await new OpenAlexSearchProvider().search({ text: 'q' });
    expect(axiosMock.get.mock.calls[1][1].params.api_key).toBe(KEY);
  });

  it('a non-JSON 200 answer is a failure', async () => {
    axiosMock.get.mockResolvedValue({ data: HTML_PAGE });
    const f = failures();
    await new OpenAlexSearchProvider().search({ text: 'q', onFailure: f.onFailure });
    expect(f.seen).toHaveLength(1);
  });
});

describe('the generic web endpoint', () => {
  it('reads `link` as the address (Serper, Google Custom Search) and leaves out a result with no address', async () => {
    config.discovery.providerBaseUrl = 'https://search.example/api';
    axiosMock.post.mockResolvedValue({ data: { organic: [{ link: 'https://s.example', title: 'S', snippet: 'x' }, { title: 'no address' }] } });
    const out = await new GenericWebSearchProvider().search({ text: 'q' });
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ url: 'https://s.example', snippet: 'x' });
  });
});
