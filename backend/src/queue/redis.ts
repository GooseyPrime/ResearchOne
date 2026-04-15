import IORedis from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let redis: IORedis;

export async function initRedis(): Promise<void> {
  redis = new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
  });

  redis.on('error', (err) => {
    logger.error('Redis error:', err);
  });

  redis.on('connect', () => {
    logger.debug('Redis connected');
  });

  await redis.connect();
}

export function getRedis(): IORedis {
  if (!redis) throw new Error('Redis not initialized. Call initRedis() first.');
  return redis;
}

export function createRedisConnection(): IORedis {
  return new IORedis({
    host: config.redis.host,
    port: config.redis.port,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });
}
