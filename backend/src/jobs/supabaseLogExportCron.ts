/**
 * Supabase Log Export Cron
 *
 * Free-tier Supabase retains logs for only 1 day. This job exports the
 * last 24 hours of logs for each configured project before they expire,
 * writing them to the local filesystem as newline-delimited JSON.
 *
 * Failure is logged as error (not silently swallowed) so monitoring can alert.
 *
 * Configuration (env vars):
 *   SUPABASE_MGMT_TOKEN    Supabase Personal Access Token (https://supabase.com/dashboard/account/tokens)
 *   SUPABASE_LOG_PROJECTS  JSON array of {ref: string, label: string} — project refs to export
 *   SUPABASE_LOG_DEST      Directory to write log files (default: /opt/researchone/logs/supabase)
 *
 * Example:
 *   SUPABASE_LOG_PROJECTS=[{"ref":"ftnhzjpyjvpyzetrcfht","label":"golden-goose-studio"}]
 */

import * as fs from 'fs';
import * as path from 'path';
import { logger } from '../utils/logger';

let intervalId: ReturnType<typeof setInterval> | null = null;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SUPABASE_MGMT_API = 'https://api.supabase.com/v1';

interface LogProject {
  ref: string;
  label: string;
}

function loadLogProjects(): LogProject[] {
  const raw = process.env.SUPABASE_LOG_PROJECTS;
  if (!raw) return [];
  try {
    return (JSON.parse(raw) as LogProject[]).filter(
      (p) => typeof p.ref === 'string' && p.ref.length > 0
    );
  } catch (err) {
    logger.error('supabase_log_export_config_parse_error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }
}

function getLogDest(): string {
  return process.env.SUPABASE_LOG_DEST ?? '/opt/researchone/logs/supabase';
}

/** Supabase Management API: fetch the last 24 h of postgres logs for a project. */
async function fetchProjectLogs(token: string, ref: string): Promise<string> {
  const now = new Date();
  const yesterday = new Date(now.getTime() - ONE_DAY_MS);
  const iso = (d: Date) => d.toISOString();

  // Supabase log endpoints (SQL-based analytics via Management API).
  // Returns JSON with a `result` array of log rows.
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const url =
      `${SUPABASE_MGMT_API}/projects/${ref}/analytics/endpoints/logs.all` +
      `?timestamp_start=${iso(yesterday)}&timestamp_end=${iso(now)}&event_message=`;

    const res = await fetch(url, {
      headers: {
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${body}`);
    }

    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function exportProjectLogs(token: string, project: LogProject, dest: string): Promise<void> {
  const dateStr = new Date().toISOString().slice(0, 10);
  const fileName = `${project.label}-${dateStr}.ndjson`;
  const filePath = path.join(dest, fileName);

  try {
    const logs = await fetchProjectLogs(token, project.ref);
    fs.writeFileSync(filePath, logs, 'utf8');
    logger.info('supabase_log_export_ok', { label: project.label, file: filePath });
  } catch (err) {
    logger.error('supabase_log_export_failed', {
      label: project.label,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

async function runLogExport(): Promise<void> {
  const token = process.env.SUPABASE_MGMT_TOKEN;
  if (!token) {
    logger.info('supabase_log_export_skipped', { reason: 'SUPABASE_MGMT_TOKEN not configured' });
    return;
  }

  const projects = loadLogProjects();
  if (projects.length === 0) {
    logger.info('supabase_log_export_skipped', { reason: 'SUPABASE_LOG_PROJECTS not configured' });
    return;
  }

  const dest = getLogDest();
  fs.mkdirSync(dest, { recursive: true });

  logger.info('supabase_log_export_started', { count: projects.length, dest });
  for (const project of projects) {
    await exportProjectLogs(token, project, dest);
  }
  logger.info('supabase_log_export_finished', { count: projects.length });
}

export function startSupabaseLogExportCron(): void {
  if (intervalId) return;
  runLogExport();
  intervalId = setInterval(runLogExport, ONE_DAY_MS);
}

export function stopSupabaseLogExportCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
