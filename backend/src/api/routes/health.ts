import { Router } from 'express';
import fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { getPool } from '../../db/pool';
import { getRedis } from '../../queue/redis';
import { atlasExportQueue, embeddingQueue, ingestionQueue, researchQueue } from '../../queue/queues';
import { config } from '../../config';

const router = Router();

type Check = { ok: boolean; latencyMs?: number; writable?: boolean; modelProbe?: string };

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
    exports: { ok: exportsProbe.ok, writable: exportsProbe.ok },
    websocket: websocketCheck,
  };

  const failed = Object.values(checks).filter((c) => !c.ok).length;
  const status = failed === 0 ? 'ok' : failed <= 2 ? 'degraded' : 'down';

  return {
    status,
    timestamp: new Date().toISOString(),
    checks,
    restartAvailable: Boolean(config.admin.token),
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
