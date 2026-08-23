/**
 * Shared configuration loading for the Supabase operations cron jobs.
 *
 * All three jobs (keep-alive, log export, backup) read a JSON array of project
 * descriptors from an environment variable and use `label` in log fields and
 * filenames. Two defects came out of each job doing that for itself:
 *
 *  - `label` was not validated, so a descriptor missing it logged
 *    `label: undefined` and produced ambiguous filenames.
 *  - `label` reached a filename unsanitized, so a value containing `/` or `..`
 *    could write outside the backup destination.
 *
 * Both are fixed once here rather than three times. (Copilot / Codex, #224.)
 */

import { logger } from '../utils/logger';

/** A label safe to interpolate into a filename. */
export function sanitizeLabel(label: string): string {
  const cleaned = label
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^[.-]+/, '')
    .replace(/-+$/, '')
    .slice(0, 64);
  return cleaned || 'unlabeled';
}

/**
 * Parse a JSON array of project descriptors from an environment variable.
 *
 * `label` is required alongside the caller's own required fields: it is used
 * for correlation in every log line these jobs emit, and an entry without one
 * cannot be acted on usefully. Entries that fail validation are dropped and
 * counted, never silently ignored — a config typo that quietly disables a
 * backup is the failure mode this whole runbook exists to prevent.
 */
export function loadProjectConfig<T extends { label: string }>(
  envVar: string,
  jobName: string,
  isValid: (candidate: Record<string, unknown>) => boolean
): T[] {
  const raw = process.env[envVar];
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    logger.error(`${jobName}_config_parse_error`, {
      envVar,
      error: err instanceof Error ? err.message : String(err),
    });
    return [];
  }

  if (!Array.isArray(parsed)) {
    logger.error(`${jobName}_config_not_an_array`, { envVar });
    return [];
  }

  const accepted: T[] = [];
  let rejected = 0;
  for (const candidate of parsed) {
    if (
      candidate
      && typeof candidate === 'object'
      && typeof (candidate as Record<string, unknown>).label === 'string'
      && ((candidate as Record<string, unknown>).label as string).trim().length > 0
      && isValid(candidate as Record<string, unknown>)
    ) {
      accepted.push(candidate as T);
      continue;
    }
    rejected += 1;
  }

  if (rejected > 0) {
    logger.error(`${jobName}_config_entries_rejected`, {
      envVar,
      rejected,
      accepted: accepted.length,
      hint: 'each entry needs a non-empty label plus the fields this job requires',
    });
  }

  return accepted;
}

/**
 * Run a cron body so a rejection can never become an unhandled rejection.
 *
 * `setInterval(fn)` and a bare `fn()` both discard the returned promise. A
 * failure before the per-item try/catch — `mkdirSync` hitting a read-only
 * filesystem or a full disk, for instance — then propagates as an unhandled
 * rejection, which can terminate and restart the whole API process. An ops job
 * must never be able to take the service down (Codex, #224).
 */
export function guardCronRun(jobName: string, run: () => Promise<void>): void {
  void run().catch((err: unknown) => {
    logger.error(`${jobName}_cron_run_failed`, {
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
