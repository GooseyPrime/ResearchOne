/** Canonical SPA path for live research (Standard and Deep share one route). */
export const RESEARCH_PAGE_PATH = '/app/research';

/** Query param value selecting Deep Research (V2 engine) on the unified page. */
export const DEEP_RESEARCH_ENGINE_QUERY = 'v2';

/** Canonical SPA target for opening a completed run’s report in the dossier shell. */
export function dossierReportUrlForRun(runId: string): string {
  return `/app/dossiers/${runId}#report`;
}

export type ResearchEngineVersion = 'v2' | 'v1' | undefined;

export function isDeepResearchEngine(engineVersion?: string | null): boolean {
  return engineVersion === 'v2';
}

/** True when `?engine=v2` selects Deep Research on `/app/research`. */
export function isDeepResearchFromSearchParams(
  searchParams: URLSearchParams | { get: (key: string) => string | null }
): boolean {
  return searchParams.get('engine')?.trim() === DEEP_RESEARCH_ENGINE_QUERY;
}

/** Live research page path (always `/app/research`; engine is a query param). */
export function researchPagePathForEngine(_engineVersion?: string | null): string {
  return RESEARCH_PAGE_PATH;
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

function researchSearchParams(runId: string, engineVersion?: string | null): URLSearchParams {
  const params = new URLSearchParams();
  params.set('runId', runId);
  if (isDeepResearchEngine(engineVersion)) {
    params.set('engine', DEEP_RESEARCH_ENGINE_QUERY);
  }
  return params;
}

/** Deep link to resume live tracking and plan review on the unified research page. */
export function liveResearchUrl(
  runId: string,
  opts?: { engineVersion?: string | null; focusPlan?: boolean }
): string {
  const params = researchSearchParams(runId, opts?.engineVersion);
  const hash = opts?.focusPlan ? '#plan' : '';
  return `${RESEARCH_PAGE_PATH}?${params.toString()}${hash}`;
}

/** Entry URL for Deep Research mode (no active run). */
export const DEEP_RESEARCH_PAGE_URL = `${RESEARCH_PAGE_PATH}?engine=${DEEP_RESEARCH_ENGINE_QUERY}`;

/** Failed-run diagnostics page (manual / bookmark). */
export function failedRunReportUrl(runId: string): string {
  return `/app/reports/run/${runId}`;
}
