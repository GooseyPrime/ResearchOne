import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import app from './api/app';
import { logger } from './utils/logger';
import { initDb } from './db/pool';
import { initRedis } from './queue/redis';
import { startWorkers } from './queue/workers';
import { getLoadedEnvFilePath } from './bootstrap/loadEnv';
import { validateEnvModelPolicy } from './config/modelRuntime';
import { config } from './config';
import { refreshRuntimeModelOverrides } from './services/runtimeModelStore';

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

    // Attach io to app for route access
    app.set('io', io);

    io.on('connection', (socket) => {
      logger.info(`WebSocket client connected: ${socket.id}`);

      socket.on('subscribe:job', (jobId: string) => {
        socket.join(`job:${jobId}`);
      });

      socket.on('subscribe:corpus', () => {
        socket.join('corpus');
      });

      socket.on('disconnect', () => {
        logger.info(`WebSocket client disconnected: ${socket.id}`);
      });
    });

    await startWorkers(io);
    logger.info('BullMQ workers started');

    httpServer.listen(config.port, () => {
      logger.info(`ResearchOne API listening on port ${config.port}`);
    });
  } catch (err) {
    logger.error('Fatal startup error:', err);
    process.exit(1);
  }
}

main();
