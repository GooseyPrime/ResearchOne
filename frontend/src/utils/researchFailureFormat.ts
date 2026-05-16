/** Shared failure-string formatting for research run UI (RunRow, FailureCard, sockets). */
export function formatFailureReason(message: string, failureMeta?: Record<string, unknown>): string {
  if (!failureMeta) return message;
  const providerMessage = typeof failureMeta.providerMessage === 'string' ? failureMeta.providerMessage : undefined;
  const status = typeof failureMeta.status === 'number' ? String(failureMeta.status) : undefined;
  const classification = typeof failureMeta.classification === 'string' ? failureMeta.classification : undefined;
  const endpoint = typeof failureMeta.endpoint === 'string' ? failureMeta.endpoint : undefined;
  const hint = typeof failureMeta.hint === 'string' ? failureMeta.hint : undefined;
  const reason = typeof failureMeta.reason === 'string' ? failureMeta.reason : undefined;
  const orchestratorHints = Array.isArray(failureMeta.orchestratorHints)
    ? failureMeta.orchestratorHints.filter((h) => typeof h === 'string').join(' | ')
    : undefined;

  const details = [
    classification ? `classification=${classification}` : '',
    status ? `status=${status}` : '',
    endpoint ? `endpoint=${endpoint}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  if (!providerMessage && !details && !orchestratorHints && !hint && !reason) return message;
  return [message, providerMessage, details, reason, hint, orchestratorHints].filter(Boolean).join(' | ');
}
