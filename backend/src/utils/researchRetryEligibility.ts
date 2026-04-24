/**
 * Shared predicate for POST /api/research/:id/retry-from-failure eligibility.
 * `resumeAvailable` is legacy; `retryable` is the current field.
 */
export function isFailureMetaRetryable(failureMeta: Record<string, unknown> | null | undefined): boolean {
  const fm = failureMeta ?? {};
  return fm.retryable === true || fm.resumeAvailable === true;
}

/**
 * Preserves orchestrator fields (classification, role, etc.) while updating retry bookkeeping
 * so subsequent resume attempts still pass isFailureMetaRetryable.
 */
export function mergeFailureMetaForRetry(
  existing: Record<string, unknown> | null | undefined,
  nextRetryCount: number
): Record<string, unknown> {
  const fm = { ...(existing ?? {}) };
  const failingRole = typeof fm.role === 'string' ? String(fm.role) : undefined;
  return {
    ...fm,
    retryCount: nextRetryCount,
    retryable: true,
    resumeAvailable: true,
    role: failingRole ?? fm.role ?? null,
    lastRetryAt: new Date().toISOString(),
  };
}
