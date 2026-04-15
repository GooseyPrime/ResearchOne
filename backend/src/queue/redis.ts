import IORedis, { RedisOptions } from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let redis: IORedis;

function buildRedisOptions(): RedisOptions {
  return {
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password ? { password: config.redis.password } : {}),
    ...(config.redis.username ? { username: config.redis.username } : {}),
    maxRetriesPerRequest: null, // Required for BullMQ
    enableReadyCheck: false,
    lazyConnect: true,
  };
}

export async function initRedis(): Promise<void> {
  redis = new IORedis(buildRedisOptions());

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
  const opts = buildRedisOptions();
  // createRedisConnection is used by BullMQ which manages its own lifecycle -- don't lazyConnect
  return new IORedis({ ...opts, lazyConnect: false });
}
