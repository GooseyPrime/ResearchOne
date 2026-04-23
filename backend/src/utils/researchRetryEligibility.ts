/**
 * Shared predicate for POST /api/research/:id/retry-from-failure eligibility.
 * `resumeAvailable` is legacy; `retryable` is the current field.
 */
export function isFailureMetaRetryable(failureMeta: Record<string, unknown> | null | undefined): boolean {
  const fm = failureMeta ?? {};
  return fm.retryable === true || fm.resumeAvailable === true;
}
