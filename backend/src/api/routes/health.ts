import { Router } from 'express';
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

export async function buildHealth(req: { app: { get: (k: string) => unknown } }) {
  const apiCheck: Check = { ok: true, latencyMs: 0 };

  const dbProbe = await timedCheck(async () => getPool().query('SELECT 1'));
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

  const checks = {
    api: apiCheck,
    db: { ok: dbProbe.ok, latencyMs: dbProbe.latencyMs },
    redis: { ok: redisProbe.ok, latencyMs: redisProbe.latencyMs },
    queue: { ok: queueProbe.ok, latencyMs: queueProbe.latencyMs },
    openrouter: {
      ok: openrouterProbe.ok,
      latencyMs: openrouterProbe.latencyMs,
      modelProbe: openrouterProbe.value,
    },
    discovery: discoveryCheck,
    exports: { ok: exportsProbe.ok, writable: exportsProbe.ok },
    websocket: websocketCheck,
  };

  const anyDown = Object.values(checks).some((c) => !c.ok);
  const status = anyDown ? 'down' : 'ok';

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
    checks,
    restartAvailable: Boolean(config.admin.token || config.admin.userIds.length > 0),
  };
}

router.get('/', async (req, res) => {
  const payload = await buildHealth(req);
  res.status(payload.status === 'down' ? 503 : 200).json(payload);
});

router.get('/ready', async (req, res) => {
  const payload = await buildHealth(req);
  const ready = payload.status !== 'down';
  res.status(ready ? 200 : 503).json({ ready, ...payload });
});

export default router;
