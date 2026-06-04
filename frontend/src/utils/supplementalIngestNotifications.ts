export type SupplementalFileOutcome =
  | { filename: string; status: 'queued'; ingestionJobId: string }
  | { filename: string; status: 'skipped'; reason: string }
  | { filename: string; status: 'failed'; reason: string };

export type SupplementalIngestOutcome = {
  jobId: string;
  status: string;
  fileName: string | null;
  url: string | null;
  errorMessage: string | null;
};

export type SupplementalIngestSummary = {
  urlsQueued: number;
  filesQueued: number;
  filesAttempted?: number;
  jobIds: string[];
  fileOutcomes?: SupplementalFileOutcome[];
  ingestOutcomes?: SupplementalIngestOutcome[];
};

export type SupplementalIngestNotifySeverity = 'info' | 'error';

export type SupplementalIngestNotification = {
  severity: SupplementalIngestNotifySeverity;
  message: string;
};

/**
 * Derive user-visible toasts from supplemental ingest API feedback.
 * Returns info for partial success and error when every attachment failed.
 */
export function buildSupplementalIngestNotifications(
  ing: SupplementalIngestSummary | undefined,
  opts?: { researchLabel?: string },
): SupplementalIngestNotification[] {
  if (!ing) return [];

  const label = opts?.researchLabel ?? 'Research';
  const notifications: SupplementalIngestNotification[] = [];

  const failedFiles = (ing.fileOutcomes ?? []).filter((o) => o.status === 'failed' || o.status === 'skipped');
  const failedIngest = (ing.ingestOutcomes ?? []).filter((o) => o.status === 'failed');

  const hasQueued = ing.urlsQueued > 0 || ing.filesQueued > 0;

  if (hasQueued) {
    const parts: string[] = [];
    if (ing.urlsQueued > 0) parts.push(`${ing.urlsQueued} URL(s)`);
    if (ing.filesQueued > 0) parts.push(`${ing.filesQueued} file(s)`);
    notifications.push({
      severity: 'info',
      message: `${label} started — queued ${parts.join(' and ')} for ingestion.`,
    });
  }

  if (ing.filesAttempted != null && ing.filesQueued < ing.filesAttempted) {
    const notQueued = ing.filesAttempted - ing.filesQueued;
    notifications.push({
      severity: 'error',
      message: `${notQueued} attached file(s) could not be queued for ingestion.`,
    });
  }

  for (const outcome of failedFiles) {
    if (outcome.status === 'failed' || outcome.status === 'skipped') {
      notifications.push({
        severity: 'error',
        message: `Could not ingest "${outcome.filename}": ${outcome.reason}`,
      });
    }
  }

  for (const outcome of failedIngest) {
    const name = outcome.fileName ?? outcome.url ?? outcome.jobId;
    const detail = outcome.errorMessage?.trim() || 'Ingestion failed';
    notifications.push({
      severity: 'error',
      message: `Ingestion failed for "${name}": ${detail}`,
    });
  }

  if (!hasQueued && failedFiles.length === 0 && failedIngest.length === 0) {
    return [];
  }

  if (!hasQueued && (failedFiles.length > 0 || failedIngest.length > 0)) {
    return notifications.length > 0
      ? notifications
      : [{ severity: 'error', message: `${label} started, but supplemental attachments could not be ingested.` }];
  }

  return notifications;
}

/** Push supplemental ingest toasts (or a default "started" info toast). */
export function applySupplementalIngestNotifications(
  ing: SupplementalIngestSummary | undefined,
  notify: (severity: SupplementalIngestNotifySeverity, message: string) => void,
  opts?: { researchLabel?: string; defaultStartedMessage?: string },
): void {
  const notes = buildSupplementalIngestNotifications(ing, opts);
  if (notes.length === 0) {
    notify('info', opts?.defaultStartedMessage ?? 'Research started — tracking detailed progress...');
    return;
  }
  for (const note of notes) {
    notify(note.severity, note.message);
  }
}
