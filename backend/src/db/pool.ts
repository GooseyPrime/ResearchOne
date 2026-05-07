import { Pool, PoolClient } from 'pg';
import { config } from '../config';
import { logger } from '../utils/logger';

let pool: Pool;
let adminPool: Pool;

export async function initDb(): Promise<void> {
  const baseOpts = {
    connectionString: config.db.url,
    host: config.db.host,
    port: config.db.port,
    database: config.db.name,
    password: config.db.password,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };

  // Admin pool: uses the configured superuser for migrations, webhooks, and admin routes.
  adminPool = new Pool({
    ...baseOpts,
    user: config.db.user,
    max: 5,
  });
  adminPool.on('error', (err) => {
    logger.error('Unexpected PostgreSQL admin pool error:', err);
  });

  // Application pool: uses application_role when available for RLS enforcement.
  // Falls back to the configured user if application_role doesn't exist yet
  // (deploy-skew tolerance: code deploys before migration 021).
  const appRoleUser = process.env.DB_APP_ROLE ?? 'application_role';
  pool = new Pool({
    ...baseOpts,
    user: appRoleUser,
    max: 20,
  });
  pool.on('error', (err) => {
    if ((err as { code?: string }).code === '28000') {
      logger.warn('application_role does not exist yet — falling back to admin pool for queries. Run migration 021_rls_setup.sql.');
      pool = adminPool;
      return;
    }
    logger.error('Unexpected PostgreSQL pool error:', err);
  });

  // Test connection — try app pool first, fall back to admin if role doesn't exist
  try {
    const client = await pool.connect();
    client.release();
  } catch (err) {
    const pgCode = (err as { code?: string })?.code;
    if (pgCode === '28000' || pgCode === '28P01') {
      logger.warn('application_role not available — using admin pool for all queries until migration 021 is applied');
      pool = adminPool;
      const client = await pool.connect();
      client.release();
    } else {
      throw err;
    }
  }
}

export function getPool(): Pool {
  if (!pool) throw new Error('Database not initialized. Call initDb() first.');
  return pool;
}

export function getAdminPool(): Pool {
  if (!adminPool) throw new Error('Database not initialized. Call initDb() first.');
  return adminPool;
}

export async function query<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
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
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Executes a query using the admin pool (bypasses RLS).
 * Use for migrations, webhook handlers, and admin routes.
 */
export async function adminQuery<T = Record<string, unknown>>(
  text: string,
  params?: unknown[]
): Promise<T[]> {
  const result = await getAdminPool().query(text, params);
  return result.rows as T[];
}
