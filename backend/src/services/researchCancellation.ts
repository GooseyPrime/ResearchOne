import { getRedis } from '../queue/redis';

export class ResearchCancelledError extends Error {
  constructor() {
    super('Research run cancelled by user');
    this.name = 'ResearchCancelledError';
  }
}

const KEY_PREFIX = 'research:cancel:';
const TTL_SEC = 86400 * 7;

export async function markRunCancelled(runId: string): Promise<void> {
  await getRedis().setex(`${KEY_PREFIX}${runId}`, TTL_SEC, '1');
}

export async function isRunCancellationRequested(runId: string): Promise<boolean> {
  const v = await getRedis().get(`${KEY_PREFIX}${runId}`);
  return v === '1';
}

export async function clearRunCancelled(runId: string): Promise<void> {
  await getRedis().del(`${KEY_PREFIX}${runId}`);
}
