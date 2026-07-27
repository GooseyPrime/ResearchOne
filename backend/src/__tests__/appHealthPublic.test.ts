import http from 'node:http';
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';

const dbQuery = vi.fn();
const redisPing = vi.fn();
const queueCounts = vi.fn();
const axiosGet = vi.fn();
const mkdir = vi.fn();
const writeFile = vi.fn();
const unlink = vi.fn();

vi.mock('../db/pool', () => ({
  getPool: () => ({ query: dbQuery }),
  query: dbQuery,
  rlsStore: {
    run: <T>(_ctx: unknown, fn: () => T): T => fn(),
  },
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

vi.mock('../config', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config')>();
  return {
    config: {
      ...mod.config,
      nodeEnv: 'test',
    },
  };
});

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn().mockRejectedValue(new Error('no token')),
}));

/**
 * Regression: monitors must not mount under bare `/api` with global requireAuth.
 * Health must be reachable for load balancers without Authorization.
 */
describe('Express app — public health vs authenticated monitors', () => {
  let port = 0;
  let server: http.Server | undefined;
  const adminRuntimeToken = 'test-admin-runtime-token';
  const originalAdminRuntimeToken = process.env.ADMIN_RUNTIME_TOKEN;

  beforeAll(async () => {
    process.env.ADMIN_RUNTIME_TOKEN = adminRuntimeToken;
    const { default: app } = await import('../api/app');
    server = http.createServer(app);
    await new Promise<void>((resolve, reject) => {
      server!.listen(0, '127.0.0.1', () => resolve());
      server!.on('error', reject);
    });
    const addr = server!.address();
    if (addr && typeof addr === 'object') port = addr.port;
  });

  afterAll(async () => {
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server!.close((err) => (err ? reject(err) : resolve()));
    });
    if (originalAdminRuntimeToken === undefined) delete process.env.ADMIN_RUNTIME_TOKEN;
    else process.env.ADMIN_RUNTIME_TOKEN = originalAdminRuntimeToken;
  });

  beforeEach(() => {
    dbQuery.mockReset();
    redisPing.mockReset();
    queueCounts.mockReset();
    axiosGet.mockReset();
    mkdir.mockReset();
    writeFile.mockReset();
    unlink.mockReset();
    dbQuery.mockResolvedValue({ rows: [{ ok: 1, application_role_exists: true }] });
    redisPing.mockResolvedValue('PONG');
    queueCounts.mockResolvedValue({ waiting: 0 });
    axiosGet.mockResolvedValue({ data: {} });
    mkdir.mockResolvedValue(undefined);
    writeFile.mockResolvedValue(undefined);
    unlink.mockResolvedValue(undefined);
    process.env.PARALLEL_API_KEY = 'test-parallel-key';
    process.env.SCITE_API_KEY = 'test-scite-key';
  });

  async function get(path: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
    const res = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: { Accept: 'application/json', ...(headers ?? {}) },
    });
    const body = await res.text();
    return { status: res.status, body };
  }

  it('GET /api/health without Authorization is not 401', async () => {
    const { status } = await get('/api/health');
    expect(status).not.toBe(401);
  });

  it('GET /api/health/ready without Authorization is not 401', async () => {
    const { status } = await get('/api/health/ready');
    expect(status).not.toBe(401);
  });

  it('redacts health details for non-admin requests', async () => {
    const { status, body } = await get('/api/health');
    expect([200, 503]).toContain(status);
    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.status).toBeTypeOf('string');
    expect(payload.timestamp).toBeTypeOf('string');
    expect(payload.checks).toBeUndefined();
    expect(payload.restartAvailable).toBeUndefined();
  });

  it('includes detailed health checks with a valid admin runtime token', async () => {
    const { status, body } = await get('/api/health', { 'x-admin-token': adminRuntimeToken });
    expect([200, 503]).toContain(status);
    const payload = JSON.parse(body) as Record<string, unknown>;
    expect(payload.checks).toBeDefined();
    expect(payload.restartAvailable).toBeDefined();
  });

  it('GET /health without Authorization is not 401 (non-/api prefix)', async () => {
    const { status } = await get('/health');
    expect(status).not.toBe(401);
  });

  it('GET /api/monitors without auth still returns 401', async () => {
    const { status, body } = await get('/api/monitors');
    expect(status).toBe(401);
    expect(body).toContain('Unauthorized');
  });
});
