import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbQuery = vi.fn();
const redisPing = vi.fn();
const queueCounts = vi.fn();
const axiosGet = vi.fn();
const mkdir = vi.fn();
const writeFile = vi.fn();
const unlink = vi.fn();

vi.mock('../db/pool', () => ({
  getPool: () => ({ query: dbQuery }),
}));

vi.mock('../queue/redis', () => ({
  getRedis: () => ({ ping: redisPing }),
}));

vi.mock('../queue/queues', () => ({
  ingestionQueue: { getJobCounts: queueCounts },
  embeddingQueue: { getJobCounts: queueCounts },
  researchQueue: { getJobCounts: queueCounts },
  atlasExportQueue: { getJobCounts: queueCounts },
}));

vi.mock('axios', () => ({
  default: { get: axiosGet },
}));

vi.mock('fs/promises', () => ({
  default: { mkdir, writeFile, unlink },
  mkdir,
  writeFile,
  unlink,
}));

vi.mock('../config', () => ({
  config: {
    nodeEnv: 'test',
    openrouter: { apiKey: 'token', baseUrl: 'https://openrouter.ai/api/v1' },
    models: { planner: 'planner-model' },
    discovery: {
      enabled: true,
      provider: 'tavily',
      tavilyApiKey: 'tavily-token',
      providerApiKey: '',
      providerBaseUrl: '',
    },
    exports: { dir: '/tmp/exports' },
    admin: { token: 'admintoken' },
  },
}));

describe('health route payload', () => {
  beforeEach(() => {
    dbQuery.mockReset();
    redisPing.mockReset();
    queueCounts.mockReset();
    axiosGet.mockReset();
    mkdir.mockReset();
    writeFile.mockReset();
    unlink.mockReset();
    dbQuery.mockResolvedValueOnce({ rows: [{ '?column?': 1 }] });
    redisPing.mockResolvedValueOnce('PONG');
    queueCounts.mockResolvedValue({ waiting: 0 });
    axiosGet.mockResolvedValueOnce({ data: {} });
    mkdir.mockResolvedValueOnce(undefined);
    writeFile.mockResolvedValueOnce(undefined);
    unlink.mockResolvedValueOnce(undefined);
  });

  it('returns structured health payload with checks', async () => {
    const { buildHealth } = await import('../api/routes/health');
    const result = await buildHealth({ app: { get: () => ({}) } });
    expect(result.status).toBe('ok');
    expect(result.service).toBe('ResearchOne API');
    expect(typeof result.version).toBe('string');
    expect(result.gitSha).toBeDefined();
    expect(result.nodeEnv).toBeDefined();
    expect(result.checks.db.ok).toBe(true);
    expect(result.checks.redis.ok).toBe(true);
    expect(result.checks.openrouter.modelProbe).toBe('planner-model');
    expect(result.checks.discovery.provider).toBe('tavily');
    expect(result.checks.discovery.ready).toBe(true);
    expect(result.restartAvailable).toBe(true);
  });

  it('returns degraded when one subsystem is down', async () => {
    dbQuery.mockReset();
    redisPing.mockReset();
    queueCounts.mockReset();
    axiosGet.mockReset();
    mkdir.mockReset();
    writeFile.mockReset();
    unlink.mockReset();
    dbQuery.mockRejectedValueOnce(new Error('db down'));
    redisPing.mockResolvedValueOnce('PONG');
    queueCounts.mockResolvedValue({ waiting: 0 });
    axiosGet.mockResolvedValueOnce({ data: {} });
    mkdir.mockResolvedValueOnce(undefined);
    writeFile.mockResolvedValueOnce(undefined);
    unlink.mockResolvedValueOnce(undefined);

    const { buildHealth } = await import('../api/routes/health');
    const result = await buildHealth({ app: { get: () => ({}) } });
    expect(result.status).toBe('degraded');
    expect(result.checks.db.ok).toBe(false);
  });
});
