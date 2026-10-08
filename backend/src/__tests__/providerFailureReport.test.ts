/**
 * Slice 7. The shipped providers return [] when they cannot search, so the run
 * can only record the failure if the provider tells it. These use the real
 * provider classes with the network replaced.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('axios', () => {
  const fail = vi.fn(async () => {
    throw Object.assign(new Error('Request failed with status code 503'), { name: 'AxiosError', response: { status: 503 } });
  });
  return { default: { get: fail, post: fail, head: fail, create: () => ({ get: fail, post: fail, head: fail }), isAxiosError: () => true } };
});

import { config } from '../config';
import { OpenAlexSearchProvider } from '../services/discovery/providers/openAlexSearch';
import { CrossrefSearchProvider } from '../services/discovery/providers/crossrefSearch';
import { ParallelSearchProvider } from '../services/discovery/providers/parallelSearch';
import { providerErrorRecord } from '../services/discovery/discoveryOrchestrator';
import { PROVIDER_NOT_CONFIGURED } from '../services/discovery/providerTypes';

describe('providers tell the run when they could not search', () => {
  it.each([
    ['OpenAlex', () => new OpenAlexSearchProvider()],
    ['Crossref', () => new CrossrefSearchProvider()],
  ])('%s reports a failed request and still returns nothing', async (_name, build) => {
    const failures: unknown[] = [];
    await expect(build().search({ text: 'nuclear costs', onFailure: (failure) => failures.push(failure) })).resolves.toEqual([]);
    expect(failures).toHaveLength(1);
    expect(providerErrorRecord(failures[0])).toEqual({ error_kind: 'AxiosError', http_status: 503 });
  });

  it('a provider with no key reports that it is not configured', async () => {
    const was = config.discovery.parallelApiKey;
    (config.discovery as { parallelApiKey: string }).parallelApiKey = '';
    const failures: unknown[] = [];
    await new ParallelSearchProvider().search({ text: 'pet supplements', onFailure: (failure) => failures.push(failure) });
    (config.discovery as { parallelApiKey: string }).parallelApiKey = was;
    expect(failures).toEqual([PROVIDER_NOT_CONFIGURED]);
    expect(providerErrorRecord(failures[0])).toEqual({ error_kind: 'not_configured' });
  });

  it('without the callback a provider behaves as before', async () => {
    await expect(new OpenAlexSearchProvider().search({ text: 'nuclear costs' })).resolves.toEqual([]);
  });
});
