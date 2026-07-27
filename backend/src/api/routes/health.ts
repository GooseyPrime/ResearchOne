import { Router } from 'express';
import { timingSafeEqual } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { getPool } from '../../db/pool';
import { getRedis } from '../../queue/redis';
import { atlasExportQueue, embeddingQueue, ingestionQueue, researchQueue } from '../../queue/queues';
import { config } from '../../config';
import { getBackendPackageVersion, getBuildMeta } from '../../bootstrap/buildMeta';

const router = Router();

const SERVICE_NAME = 'ResearchOne API';

type Check = {
  ok: boolean;
  latencyMs?: number;
  writable?: boolean;
  modelProbe?: string;
  provider?: string;
  ready?: boolean;
  /** When `false`, Postgres role `application_role` is missing or unusable for SET ROLE. Only defined when the DB probe query succeeded. */
  rlsReady?: boolean;
  reason?: string;
};

type IntegrationCheck = {
  configured: boolean;
  ok: boolean;
  latencyMs?: number;
  reason?: string;
};

function getDiscoveryReadinessCheck(): Check {
  if (!config.discovery.enabled) {
    return {
      ok: true,
      provider: 'disabled',
      ready: false,
      reason: 'DISCOVERY_ENABLED=false',
    };
  }

  const provider = config.discovery.provider;
  if (provider === 'tavily') {
    const ready = Boolean(config.discovery.tavilyApiKey.trim());
    return { ok: ready, provider, ready, reason: ready ? undefined : 'TAVILY_API_KEY missing' };
  }
  if (provider === 'brave') {
    const ready = Boolean(config.discovery.providerApiKey.trim());
    return { ok: ready, provider, ready, reason: ready ? undefined : 'SEARCH_PROVIDER_API_KEY missing' };
  }
  if (provider === 'generic') {
    const ready = Boolean(config.discovery.providerBaseUrl.trim());
    return { ok: ready, provider, ready, reason: ready ? undefined : 'SEARCH_PROVIDER_BASE_URL missing' };
  }
  if (provider === 'cascade') {
    const tavilyReady = Boolean(config.discovery.tavilyApiKey.trim());
    const braveReady = Boolean(config.discovery.providerApiKey.trim());
    const genericReady = Boolean(config.discovery.providerBaseUrl.trim());
    const ready = tavilyReady || braveReady || genericReady;
    return {
      ok: ready,
      provider,
      ready,
      reason: ready ? undefined : 'No cascade providers configured (need Tavily, Brave, or Generic credentials)',
    };
  }
  return { ok: false, provider, ready: false, reason: 'Invalid discovery provider' };
}

async function timedCheck<T>(fn: () => Promise<T>): Promise<{ ok: boolean; latencyMs?: number; value?: T }> {
  const started = Date.now();
  try {
    const value = await fn();
    return { ok: true, latencyMs: Date.now() - started, value };
  } catch {
    return { ok: false, latencyMs: Date.now() - started };
  }
}

async function probeOptionalIntegration(
  keyEnvVar: string,
  healthUrl: string,
): Promise<IntegrationCheck> {
  const key = process.env[keyEnvVar]?.trim();
  if (!key) {
    return { configured: false, ok: true, reason: `${keyEnvVar} not set` };
  }
  const started = Date.now();
  try {
    await axios.get(healthUrl, {
      timeout: 5000,
      headers: { Authorization: `Bearer ${key}` },
    });
    return { configured: true, ok: true, latencyMs: Date.now() - started };
  } catch {
    return { configured: true, ok: false, latencyMs: Date.now() - started, reason: 'probe failed' };
  }
}

export async function buildHealth(req: { app: { get: (k: string) => unknown } }) {
  const apiCheck: Check = { ok: true, latencyMs: 0 };

  const dbProbe = await timedCheck(async () => {
    const result = await getPool().query<{ ok: number; application_role_exists: boolean }>(
      "SELECT 1 AS ok, EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'application_role') AS application_role_exists",
    );
    const row = result.rows[0];
    if (!row) throw new Error('db health probe returned no row');
    return row;
  });
  const redisProbe = await timedCheck(async () => getRedis().ping());
  const queueProbe = await timedCheck(async () => {
    await Promise.all([
      ingestionQueue.getJobCounts('waiting'),
      embeddingQueue.getJobCounts('waiting'),
      researchQueue.getJobCounts('waiting'),
      atlasExportQueue.getJobCounts('waiting'),
    ]);
  });

  const openrouterProbe = await timedCheck(async () => {
    if (!config.openrouter.apiKey) return 'missing_api_key';
    await axios.get(`${config.openrouter.baseUrl}/models`, {
      timeout: 10000,
      headers: {
        Authorization: `Bearer ${config.openrouter.apiKey}`,
      },
    });
    return config.models.planner;
  });

  const exportsProbe = await timedCheck(async () => {
    await fs.mkdir(config.exports.dir, { recursive: true });
    const testPath = path.join(config.exports.dir, `.health-${Date.now()}.tmp`);
    await fs.writeFile(testPath, 'ok');
    await fs.unlink(testPath);
    return true;
  });

  const websocketCheck: Check = { ok: Boolean(req.app.get('io')) };
  const discoveryCheck = getDiscoveryReadinessCheck();

  const [parallelCheck, sciteCheck] = await Promise.all([
    probeOptionalIntegration('PARALLEL_API_KEY', 'https://api.parallel.ai/health'),
    probeOptionalIntegration('SCITE_API_KEY', 'https://api.scite.ai/health'),
  ]);

  const dbRow = dbProbe.value;
  const applicationRolePresent = dbRow?.application_role_exists ?? false;

  const coreChecks = {
    api: apiCheck,
    db: {
      // Missing application_role means authenticated traffic runs without RLS context — fail readiness (Codex PR #104).
      ok: dbProbe.ok && applicationRolePresent,
      latencyMs: dbProbe.latencyMs,
      rlsReady: dbProbe.ok ? applicationRolePresent : undefined,
      reason:
        dbProbe.ok && !applicationRolePresent
          ? 'Postgres role application_role is missing or unusable — run `cd backend && npm run bootstrap:application-role` with DATABASE_ADMIN_URL (see docs/RUNBOOKS/application-role-bootstrap.md); migration 021 alone cannot fix this if it no-oped without CREATEROLE'
          : undefined,
    },
    redis: { ok: redisProbe.ok, latencyMs: redisProbe.latencyMs },
    queue: { ok: queueProbe.ok, latencyMs: queueProbe.latencyMs },
    openrouter: {
      ok: openrouterProbe.ok,
      latencyMs: openrouterProbe.latencyMs,
      modelProbe: openrouterProbe.value,
    },
    exports: { ok: exportsProbe.ok, writable: exportsProbe.ok },
    websocket: websocketCheck,
    discovery: discoveryCheck,
  };

  const integrations = {
    parallel: parallelCheck,
    scite: sciteCheck,
  };

  const INTEGRATION_LATENCY_THRESHOLD_MS = 2000;
  const coreDown = Object.values(coreChecks).some((c) => !c.ok);
  const integrationDegraded =
    Object.values(integrations).some(
      (c) => c.configured && (!c.ok || (c.latencyMs ?? 0) > INTEGRATION_LATENCY_THRESHOLD_MS)
    );

  const status: 'ok' | 'degraded' | 'down' = coreDown
    ? 'down'
    : integrationDegraded
      ? 'degraded'
      : 'ok';

  const meta = getBuildMeta();
  const gitSha = meta?.gitSha?.trim() || 'unknown';
  const builtAt = meta?.builtAt?.trim() || null;

  return {
    service: SERVICE_NAME,
    version: getBackendPackageVersion(),
    gitSha,
    buildSha: gitSha,
    builtAt,
    nodeEnv: config.nodeEnv,
    status,
    timestamp: new Date().toISOString(),
    checks: coreChecks,
    integrations,
    restartAvailable: Boolean(config.admin.token || config.admin.userIds.length > 0),
  };
}

function extractAuthTokenFromRequest(req: { header: (name: string) => string | undefined }): string | null {
  const adminToken = req.header('x-admin-token')?.trim();
  if (adminToken) return adminToken;
  const raw = (req.header('authorization') || '').trim();
  if (!raw) return null;
  if (raw.startsWith('Bearer ')) return raw.slice('Bearer '.length).trim() || null;
  return raw;
}

export function requestCanViewHealthDetails(req: {
  auth?: { userId?: string | null };
  header: (name: string) => string | undefined;
}): boolean {
  const userId = req.auth?.userId ?? null;
  if (userId && config.admin.userIds.includes(userId)) return true;
  const token = extractAuthTokenFromRequest(req);
  return Boolean(
    config.admin.token &&
      token &&
      token.length === config.admin.token.length &&
      timingSafeEqual(Buffer.from(token), Buffer.from(config.admin.token)),
  );
}

function publicHealthPayload(payload: Awaited<ReturnType<typeof buildHealth>>) {
  return {
    status: payload.status,
    timestamp: payload.timestamp,
  };
}

router.get('/', async (req, res) => {
  const payload = await buildHealth(req);
  const status = payload.status === 'down' ? 503 : 200;
  if (requestCanViewHealthDetails(req)) {
    res.status(status).json(payload);
    return;
  }
  res.status(status).json(publicHealthPayload(payload));
});

router.get('/ready', async (req, res) => {
  const payload = await buildHealth(req);
  const ready = payload.status !== 'down';
  const status = ready ? 200 : 503;
  if (requestCanViewHealthDetails(req)) {
    res.status(status).json({ ready, ...payload });
    return;
  }
  res.status(status).json({ ready, ...publicHealthPayload(payload) });
});

export default router;
