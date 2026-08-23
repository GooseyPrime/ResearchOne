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
 *
 * Returns `null` when the string cannot be sanitized — an unparseable URL, or
 * a password with a malformed `%` escape that `decodeURIComponent` rejects.
 * The caller must then skip the project. Falling back to the original string
 * would put the password back in argv, which is the exact exposure this
 * function exists to remove (Codex, #224 second pass).
 */
export function splitCredentials(url: string): { safeUrl: string; env: NodeJS.ProcessEnv } | null {
  try {
    const parsed = new URL(url);
    const password = decodeURIComponent(parsed.password || '');
    parsed.password = '';
    return {
      safeUrl: parsed.toString(),
      env: password ? { PGPASSWORD: password } : {},
    };
  } catch {
    return null;
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

  const credentials = splitCredentials(project.url);
  if (!credentials) {
    // Never fall back to the raw URL: it carries the password, and pg_dump
    // takes its connection string as an argv element.
    logger.error('supabase_backup_config_invalid', {
      label: project.label,
      reason: 'connection string could not be parsed or its password could not be decoded',
    });
    return;
  }
  const { safeUrl, env } = credentials;

  // Dump to a per-attempt temporary path and rename only on success. The
  // filename is dated, so a restart on the same UTC day re-runs the immediate
  // cron against the same name; writing in place meant a failed rerun deleted
  // that day's already-good backup (Codex, #224 second pass).
  const tmpPath = `${filePath}.tmp-${process.pid}`;

  logger.info('supabase_backup_started', { label: project.label, file: filePath });
  try {
    await execFileAsync('pg_dump', [
      '--format=custom',    // custom format: supports parallel restore, compression
      '--no-password',
      '--file', tmpPath,
      safeUrl,
    ], {
      timeout: 10 * 60 * 1000 /* 10 min */,
      env: { ...process.env, ...env },
    });

    // Same directory, so this is an atomic replace on POSIX.
    fs.renameSync(tmpPath, filePath);

    const stat = fs.statSync(filePath);
    logger.info('supabase_backup_ok', {
      label: project.label,
      file: filePath,
      bytes: stat.size,
    });
  } catch (err) {
    // Only the failed attempt is removed. Any previous successful dump at
    // `filePath` is untouched.
    try { fs.unlinkSync(tmpPath); } catch { /* nothing to clean up */ }
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
