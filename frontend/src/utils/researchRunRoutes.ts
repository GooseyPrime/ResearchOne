/** Canonical SPA target for opening a completed run’s report in the dossier shell. */
export function dossierReportUrlForRun(runId: string): string {
  return `/app/dossiers/${runId}#report`;
}

export type ResearchEngineVersion = 'v2' | 'v1' | undefined;

/** Live research page for a run (Standard vs Deep Research). */
export function researchPagePathForEngine(engineVersion?: string | null): string {
  return engineVersion === 'v2' ? '/app/research-v2' : '/app/research';
}

/** Path for a run row when `engine_version` is on the list item. */
export function researchPagePathForRun(run: { engine_version?: string | null }): string {
  return researchPagePathForEngine(run.engine_version);
}

export function parseRunIdFromSearchParams(
  searchParams: URLSearchParams | { get: (key: string) => string | null }
): string | null {
  const raw = searchParams.get('runId')?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Deep link to resume live tracking and plan review on the correct research page. */
export function liveResearchUrl(
  runId: string,
  opts?: { engineVersion?: string | null; focusPlan?: boolean }
): string {
  const path = researchPagePathForEngine(opts?.engineVersion);
  const hash = opts?.focusPlan ? '#plan' : '';
  return `${path}?runId=${encodeURIComponent(runId)}${hash}`;
}

/** Failed-run diagnostics page (manual / bookmark). */
export function failedRunReportUrl(runId: string): string {
  return `/app/reports/run/${runId}`;
}
