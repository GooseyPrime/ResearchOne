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

const execFileAsync = promisify(execFile);

let intervalId: ReturnType<typeof setInterval> | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

interface BackupProject {
  url: string;
  label: string;
}

function loadBackupProjects(): BackupProject[] {
  const raw = process.env.SUPABASE_BACKUP_PROJECTS;
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as BackupProject[]).filter(
      (p) => typeof p.url === 'string' && typeof p.label === 'string'
    );
  } catch (err) {
    logger.error('supabase_backup_config_parse_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function getBackupDest(): string {
  return process.env.SUPABASE_BACKUP_DEST ?? '/opt/researchone/backups/supabase';
}

async function backupProject(project: BackupProject, dest: string): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${project.label}-${dateStr}.dump`;
  const filePath = path.join(dest, fileName);

  logger.info('supabase_backup_started', { label: project.label, file: filePath });
  try {
    await execFileAsync('pg_dump', [
      '--format=custom',    // custom format: supports parallel restore, compression
      '--no-password',
      '--file', filePath,
      project.url,
    ], { timeout: 10 * 60 * 1000 /* 10 min */ });

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
      error: err instanceof Error ? err.message : String(err),
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
  runBackup();
  intervalId = setInterval(runBackup, ONE_DAY_MS);
}

export function stopSupabaseBackupCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
