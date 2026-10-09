import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './api/app';
import { logger } from './utils/logger';
import { initDb } from './db/pool';
import { initRedis } from './queue/redis';
import { startWorkers } from './queue/workers';
import { attachSocketAccessControl } from './realtime/socketAccess';
import { createRouteIo } from './realtime/routeIo';
import { getLoadedEnvFilePath } from './bootstrap/loadEnv';
import { validateEnvModelPolicy } from './config/modelRuntime';
import { config } from './config';
import { refreshRuntimeModelOverrides } from './services/runtimeModelStore';
import { runV2OpenRouterPreflightAndLog } from './services/openrouter/openrouterPreflight';
import { startTierResetCron } from './jobs/tierResetCron';
import { startRetentionCleanupCron } from './jobs/retentionCleanupCron';
import { startSupabaseKeepAliveCron } from './jobs/supabaseKeepAliveCron';
import { startSupabaseLogExportCron } from './jobs/supabaseLogExportCron';
import { startSupabaseBackupCron } from './jobs/supabaseBackupCron';

async function main() {
  try {
    const envFile = getLoadedEnvFilePath();
    logger.info('ResearchOne backend starting...', {
      envFile: envFile ?? '(dotenv not loaded — no file)',
    });

    validateEnvModelPolicy();

    await initDb();
    logger.info('PostgreSQL connected');

    try {
      await refreshRuntimeModelOverrides();
      logger.info('Runtime model overrides loaded');
    } catch (e) {
      logger.warn('Could not load runtime model overrides (run migrations if table missing):', e);
    }

    await initRedis();
    logger.info('Redis connected');

    const httpServer = createServer(app);

    const io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.corsOrigins,
        methods: ['GET', 'POST'],
      },
    });

    // Routes get a restricted handle that cannot broadcast to every page.
    app.set('io', createRouteIo(io));

    // Signed-in users only; each socket sees its own user's events (RJ-020).
    attachSocketAccessControl(io);

    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.listenHost, () => {
        logger.info(`ResearchOne API listening on ${config.listenHost}:${config.port}`);
        resolve();
      });
    });

    await startWorkers(io);
    logger.info('BullMQ workers started');

    startTierResetCron();
    logger.info('Tier reset cron started');

    startRetentionCleanupCron();
    logger.info('Retention cleanup cron started');

    startSupabaseKeepAliveCron();
    logger.info('Supabase keep-alive cron started');

    startSupabaseLogExportCron();
    logger.info('Supabase log-export cron started');

    startSupabaseBackupCron();
    logger.info('Supabase backup cron started');

    // Best-effort: probe OpenRouter to confirm every V2 default primary
    // has at least one live upstream for the configured account. Logs a
    // structured warning per affected (objective, role, slug) if not.
    // Never blocks listen.
    runV2OpenRouterPreflightAndLog().catch((e) =>
      logger.warn('[v2-preflight] unexpected error', e)
    );
  } catch (err) {
    logger.error('Fatal startup error:', err);
    process.exit(1);
  }
}

main();
