import { Pool, PoolClient } from 'pg';
import { AsyncLocalStorage } from 'async_hooks';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool;

interface RlsContext {
  userId: string | null;
  orgId: string | null;
}

export const rlsStore = new AsyncLocalStorage<RlsContext>();

export async function initDb(): Promise<void> {
  pool = new Pool({
    connectionString: config.db.url,
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    user: config.db.user,
    password: config.db.password,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL pool error:', err);
  });

  const client = await pool.connect();
  client.release();
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

/**
 * Applies RLS context (SET ROLE + set_config) to a client within a transaction.
 * set_config with is_local=true scopes variables to the current transaction.
 */
async function applyRlsContext(client: PoolClient): Promise<void> {
  const ctx = rlsStore.getStore();
  if (!ctx?.userId) return;

  try {
    await client.query('SET ROLE application_role');
    await client.query("SELECT set_config('app.user_id', $1, true)", [ctx.userId]);
    if (ctx.orgId) {
      await client.query("SELECT set_config('app.org_id', $1, true)", [ctx.orgId]);
    }
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '42704') {
      logger.warn('application_role does not exist — RLS not active (migration 021 not applied)');
    } else {
      throw err;
    }
  }
}

async function resetRole(client: PoolClient): Promise<void> {
  try {
    await client.query('RESET ROLE');
  } catch {
    // Best effort
  }
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const ctx = rlsStore.getStore();
  if (ctx?.userId) {
    const client = await getPool().connect();
    try {
      await client.query('BEGIN');
      await applyRlsContext(client);
      const result = await client.query(text, params);
      await client.query('COMMIT');
      return result.rows as T[];
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      await resetRole(client);
      client.release();
    }
  }
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

export async function queryOne<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(
  fn: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    await applyRlsContext(client);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await resetRole(client);
    client.release();
  }
}

/**
 * Executes a query bypassing RLS (no SET ROLE, no session vars).
 * Use for migrations, webhook handlers, and admin routes.
 */
export async function adminQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getPool().query(text, params);
  return result.rows as T[];
}

/**
 * @deprecated Use getPool() — admin pool concept is now handled via RESET ROLE.
 */
export function getAdminPool(): Pool {
  return getPool();
}
