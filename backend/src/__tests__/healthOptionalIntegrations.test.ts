import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../db/pool', () => ({
  getPool: () => ({ query: vi.fn().mockResolvedValue({ rows: [{ '?column?': 1 }] }) }),
}));
vi.mock('../queue/redis', () => ({
  getRedis: () => ({ ping: vi.fn().mockResolvedValue('PONG') }),
}));
vi.mock('../queue/queues', () => ({
  ingestionQueue: { getJobCounts: vi.fn().mockResolvedValue({}) },
  embeddingQueue: { getJobCounts: vi.fn().mockResolvedValue({}) },
  researchQueue: { getJobCounts: vi.fn().mockResolvedValue({}) },
  atlasExportQueue: { getJobCounts: vi.fn().mockResolvedValue({}) },
}));
vi.mock('../bootstrap/buildMeta', () => ({
  getBackendPackageVersion: () => '1.0.0-test',
  getBuildMeta: () => ({ gitSha: 'abc123', builtAt: '2026-01-01T00:00:00Z' }),
}));

const mockAxiosGet = vi.fn().mockResolvedValue({ status: 200 });
vi.mock('axios', () => ({ default: { get: (...args: unknown[]) => mockAxiosGet(...args) } }));

vi.mock('../config', () => ({
  config: {
    openrouter: { apiKey: 'fake-key', baseUrl: 'http://localhost' },
    exports: { dir: '/tmp/test-exports' },
    discovery: { enabled: false, provider: 'tavily', tavilyApiKey: '', providerApiKey: '', providerBaseUrl: '' },
    models: { planner: 'test-model' },
    admin: { token: '', userIds: [] },
    nodeEnv: 'test',
  },
}));

import fs from 'fs/promises';
vi.mock('fs/promises', async () => {
  return {
    default: { mkdir: vi.fn().mockResolvedValue(undefined), writeFile: vi.fn().mockResolvedValue(undefined), unlink: vi.fn().mockResolvedValue(undefined) },
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
    unlink: vi.fn().mockResolvedValue(undefined),
  };
});

import { buildHealth } from '../api/routes/health';

const mockReq = { app: { get: (k: string) => (k === 'io' ? {} : undefined) } };

describe('health: optional integrations', () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PARALLEL_API_KEY;
    delete process.env.SCITE_API_KEY;
    mockAxiosGet.mockResolvedValue({ status: 200 });
  });
  afterEach(() => {
    process.env = { ...origEnv };
  });

  it('returns ok when neither integration key is set', async () => {
    const result = await buildHealth(mockReq);
    expect(result.status).toBe('ok');
    expect(result.integrations.parallel.configured).toBe(false);
    expect(result.integrations.parallel.ok).toBe(true);
    expect(result.integrations.scite.configured).toBe(false);
    expect(result.integrations.scite.ok).toBe(true);
  });

  it('returns degraded (not down) when a configured integration probe fails', async () => {
    process.env.SCITE_API_KEY = 'sk_test_fake';
    mockAxiosGet.mockImplementation((url: string) => {
      if (url.includes('scite')) return Promise.reject(new Error('timeout'));
      return Promise.resolve({ status: 200 });
    });

    const result = await buildHealth(mockReq);
    expect(result.status).toBe('degraded');
    expect(result.integrations.scite.configured).toBe(true);
    expect(result.integrations.scite.ok).toBe(false);
  });

  it('degraded status still returns HTTP 200 (not 503)', async () => {
    process.env.PARALLEL_API_KEY = 'pk_test_fake';
    mockAxiosGet.mockImplementation((url: string) => {
      if (url.includes('parallel')) return Promise.reject(new Error('conn refused'));
      return Promise.resolve({ status: 200 });
    });

    const result = await buildHealth(mockReq);
    expect(result.status).toBe('degraded');
    expect(result.status).not.toBe('down');
  });
});
