import IORedis, { RedisOptions } from 'ioredis';
import { config } from '../config';
import { logger } from '../utils/logger';

let redis: IORedis;

const BULLMQ_REDIS_OPTIONS = {
  maxRetriesPerRequest: null,
  enableReadyCheck: false,
} as const satisfies Pick<RedisOptions, 'maxRetriesPerRequest' | 'enableReadyCheck'>;

/**
 * When `REDIS_URL` is set, ioredis connects via that string (per README / .env.production.example).
 * Auth is expected to be embedded in the URL; do not also rely on REDIS_PASSWORD unless your
 * provider documents both.
 */
function createRedis(lazyConnect: boolean): IORedis {
  const url = config.redis.url?.trim();
  if (url) {
    return new IORedis(url, {
      ...BULLMQ_REDIS_OPTIONS,
      lazyConnect,
    });
  }
  const opts: RedisOptions = {
    host: config.redis.host,
    port: config.redis.port,
    ...(config.redis.password ? { password: config.redis.password } : {}),
    ...(config.redis.username ? { username: config.redis.username } : {}),
    ...BULLMQ_REDIS_OPTIONS,
    lazyConnect,
  };
  return new IORedis(opts);
}

export async function initRedis(): Promise<void> {
  redis = createRedis(true);

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
  // BullMQ manages lifecycle — connect immediately (lazyConnect: false).
  return createRedis(false);
}
