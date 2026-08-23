/**
 * Supabase Backup Cron
 *
 * Free-tier Supabase has no automatic backups. This job runs a daily
 * `pg_dump` for each configured Supabase project database and writes the
 * output to the local filesystem. The owner should keep this destination
 * on durable storage (e.g. a backed-up VM disk or an attached volume).
 *
 * Failure is logged as error so monitoring can alert. A backup that
 * silently stops running is worse than none.
 *
 * Configuration (env vars):
 *   SUPABASE_BACKUP_PROJECTS  JSON array of {url: string, label: string}.
 *                             url = postgres connection string for the Supabase project.
 *                             label = human-readable name used in the filename.
 *   SUPABASE_BACKUP_DEST      Directory to write dump files (default: /opt/researchone/backups/supabase)
 *
 * Example:
 *   SUPABASE_BACKUP_PROJECTS=[{"url":"******db.ftnhzjpyjvpyzetrcfht.supabase.co:5432/postgres","label":"golden-goose-studio"}]
 *
 * Requirements:
 *   - `pg_dump` must be installed on the host (apt-get install -y postgresql-client).
 *   - The BACKUP_DEST directory must be writable by the process.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';
import { guardCronRun, loadProjectConfig, sanitizeLabel } from './supabaseProjects';

const execFileAsync = promisify(execFile);

let intervalId: ReturnType<typeof setInterval> | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface BackupProject {
  url: string;
  label: string;
}

function loadBackupProjects(): BackupProject[] {
  return loadProjectConfig<BackupProject>(
    'SUPABASE_BACKUP_PROJECTS',
    'supabase_backup',
    (c) => typeof c.url === 'string' && (c.url as string).length > 0
  );
}

/**
 * Split a postgres URL into libpq env vars and a password-free URL.
 *
 * The connection string carries the database password. Passing it as a
 * `pg_dump` argument publishes it in the host's process list for the duration
 * of the dump, and Node's `execFile` failure message embeds the full argv —
 * which was then written straight to the application log (Codex, #224).
 *
 * PGPASSWORD reaches the child through its environment instead, which is not
 * world-readable in the process table.
 */
function splitCredentials(url: string): { safeUrl: string; env: NodeJS.ProcessEnv } {
  try {
    const parsed = new URL(url);
    const password = decodeURIComponent(parsed.password || '');
    parsed.password = '';
    return {
      safeUrl: parsed.toString(),
      env: password ? { PGPASSWORD: password } : {},
    };
  } catch {
    // Not a parseable URL — hand it back untouched rather than guessing, and
    // let pg_dump report the problem.
    return { safeUrl: url, env: {} };
  }
}

/** Strip anything that looks like a credential out of a message before logging. */
function redact(message: string): string {
  return message
    .replace(/\/\/[^\s/@]*:[^\s/@]*@/g, '//***:***@')
    .replace(/PGPASSWORD=\S+/g, 'PGPASSWORD=***');
}

function getBackupDest(): string {
  return process.env.SUPABASE_BACKUP_DEST ?? '/opt/researchone/backups/supabase';
}

async function backupProject(project: BackupProject, dest: string): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  // Sanitized: an unsanitized label containing `/` or `..` composes a path
  // that escapes the backup destination entirely (Copilot, #224).
  const fileName = `${sanitizeLabel(project.label)}-${dateStr}.dump`;
  const filePath = path.join(dest, fileName);

  const { safeUrl, env } = splitCredentials(project.url);

  logger.info('supabase_backup_started', { label: project.label, file: filePath });
  try {
    await execFileAsync('pg_dump', [
      '--format=custom',    // custom format: supports parallel restore, compression
      '--no-password',
      '--file', filePath,
      safeUrl,
    ], {
      timeout: 10 * 60 * 1000 /* 10 min */,
      env: { ...process.env, ...env },
    });

    const stat = fs.statSync(filePath);
    logger.info('supabase_backup_ok', {
      label: project.label,
      file: filePath,
      bytes: stat.size,
    });
  } catch (err) {
    // Clean up partial dump so the next run creates a fresh file
    try { fs.unlinkSync(filePath); } catch { /* ignore */ }
    logger.error('supabase_backup_failed', {
      label: project.label,
      error: redact(err instanceof Error ? err.message : String(err)),
    });
  }
}

async function runBackup(): Promise<void> {
  const projects = loadBackupProjects();
  if (projects.length === 0) {
    logger.info('supabase_backup_skipped', { reason: 'SUPABASE_BACKUP_PROJECTS not configured' });
    return;
  }

  const dest = getBackupDest();
  fs.mkdirSync(dest, { recursive: true });

  logger.info('supabase_backup_cron_started', { count: projects.length, dest });
  for (const project of projects) {
    await backupProject(project, dest);
  }
  logger.info('supabase_backup_cron_finished', { count: projects.length });
}

export function startSupabaseBackupCron(): void {
  if (intervalId) return;
  guardCronRun('supabase_backup', runBackup);
  intervalId = setInterval(() => guardCronRun('supabase_backup', runBackup), ONE_DAY_MS);
}

export function stopSupabaseBackupCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
