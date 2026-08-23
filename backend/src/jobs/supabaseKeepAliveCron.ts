/**
 * Supabase Keep-Alive Cron
 *
 * Free-tier Supabase projects pause after 7 days without activity.
 * This job makes a lightweight HTTP request to each configured project
 * every 5 days to prevent that pause.
 *
 * A keep-alive that silently stops running is worse than none (WO-AE-5 brief).
 * Every attempt — success or failure — is logged at a structured level so
 * it is visible in the log export. A persistent failure fires an error log
 * that monitoring can alert on.
 *
 * Configuration (env vars, all optional — cron no-ops if SUPABASE_KEEPALIVE_PROJECTS is absent):
 *   SUPABASE_KEEPALIVE_PROJECTS  JSON array of {url: string, key: string, label: string}.
 *                                url = https://<ref>.supabase.co
 *                                key = service_role or anon key
 *                                label = human-readable name for logs
 *
 * Example:
 *   [{"url":"https://ftnhzjpyjvpyzetrcfht.supabase.co","key":"...","label":"golden-goose-studio"}]
 */

import { logger } from '../utils/logger';
import { guardCronRun, loadProjectConfig } from './supabaseProjects';

let intervalId: ReturnType<typeof setInterval> | null = null;

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;

interface SupabaseProject {
  url: string;
  key: string;
  label: string;
}

function loadProjects(): SupabaseProject[] {
  return loadProjectConfig<SupabaseProject>(
    'SUPABASE_KEEPALIVE_PROJECTS',
    'supabase_keepalive',
    (c) => typeof c.url === 'string' && typeof c.key === 'string'
  );
}

async function pingProject(project: SupabaseProject): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    // HEAD /rest/v1/ is the lightest endpoint that wakes the project.
    const res = await fetch(`${project.url}/rest/v1/`, {
      method: 'HEAD',
      headers: {
        apikey: project.key,
        Authorization: 'Bearer ' + project.key,
      },
      signal: controller.signal,
    });
    // A rotated key answers 401/403 and a paused-project wake can answer 5xx.
    // `fetch` resolves for all of them, so logging unconditionally left this
    // job permanently green while the project drifted toward its idle pause —
    // the exact outcome it exists to prevent (Codex, #224).
    if (!res.ok) {
      logger.error('supabase_keepalive_ping_failed', {
        label: project.label,
        status: res.status,
        reason: 'non-2xx response; the project was not confirmed awake',
      });
      return;
    }
    logger.info('supabase_keepalive_ping_ok', { label: project.label, status: res.status });
  } catch (err) {
    logger.error('supabase_keepalive_ping_failed', {
      label: project.label,
      error: err instanceof Error ? err.message : String(err),
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function runKeepAlive(): Promise<void> {
  const projects = loadProjects();
  if (projects.length === 0) {
    logger.info('supabase_keepalive_skipped', { reason: 'SUPABASE_KEEPALIVE_PROJECTS not configured' });
    return;
  }
  logger.info('supabase_keepalive_started', { count: projects.length });
  await Promise.all(projects.map(pingProject));
  logger.info('supabase_keepalive_finished', { count: projects.length });
}

export function startSupabaseKeepAliveCron(): void {
  if (intervalId) return;
  guardCronRun('supabase_keepalive', runKeepAlive);
  intervalId = setInterval(() => guardCronRun('supabase_keepalive', runKeepAlive), FIVE_DAYS_MS);
}

export function stopSupabaseKeepAliveCron(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
