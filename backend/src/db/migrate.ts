import * as fs from 'fs';
import * as path from 'path';
import { initDb, getPool } from './pool';
import { logger } from '../utils/logger';

async function migrate() {
  await initDb();
  const pool = getPool();

  // Create migrations tracking table
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename TEXT UNIQUE NOT NULL,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const result = await pool.query(
      'SELECT id FROM schema_migrations WHERE filename = $1',
      [file]
    );

    if (result.rows.length > 0) {
      logger.info(`Skipping already-applied migration: ${file}`);
      continue;
    }

    logger.info(`Applying migration: ${file}`);
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');

    // Some Postgres DDL (notably `ALTER TYPE ... ADD VALUE`) cannot run
    // inside a transaction block. Migrations that need that may opt out of
    // the implicit BEGIN/COMMIT wrapper by including the directive
    // `-- @migrate:no-transaction` in the file (case-insensitive,
    // whitespace-tolerant). We still record the migration in
    // schema_migrations afterward so it is not retried on the next run.
    const noTx = /--\s*@migrate:no-transaction\b/i.test(sql);

    const client = await pool.connect();
    try {
      if (noTx) {
        logger.info(`Migration ${file} declared @migrate:no-transaction — applying without transaction`);
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
      } else {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
      }
      logger.info(`Migration applied: ${file}`);
    } catch (err) {
      if (!noTx) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // ignore secondary failure on rollback
        }
      }
      logger.error(`Migration failed: ${file}`, err);
      throw err;
    } finally {
      client.release();
    }
  }

  logger.info('All migrations complete.');
  await getPool().end();
  process.exit(0);
}

migrate().catch((err) => {
  logger.error('Migration error:', err);
  process.exit(1);
});
