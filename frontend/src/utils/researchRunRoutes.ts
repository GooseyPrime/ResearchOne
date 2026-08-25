/** Canonical SPA path for the research request page. There is one. */
export const RESEARCH_PAGE_PATH = '/app/research';

/** Canonical SPA target for opening a completed run’s report in the dossier shell. */
export function dossierReportUrlForRun(runId: string): string {
  return `/app/dossiers/${runId}#report`;
}

export function parseRunIdFromSearchParams(
  searchParams: URLSearchParams | { get: (key: string) => string | null }
): string | null {
  const raw = searchParams.get('runId')?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Query param the request page reads to restore a previous run's inputs. */
export const REQUEST_PREFILL_PARAM = 'prefill';

/**
 * The canonical URL for a run in flight: its own workspace.
 *
 * This used to return `/app/research?runId=<id>`, and `ResearchPage` then
 * redirected that to `/app/run/<id>` — except when the link carried `#plan`,
 * where it stayed and rendered the plan gate instead. Which page a user landed
 * on therefore depended on whether the run happened to be awaiting plan
 * approval at the moment they clicked, and the codebase asserted both were
 * correct. Every caller of this builder now lands in one place that handles
 * every state, and stays there.
 *
 * `#plan` still means "take me to the gate" — the gate renders at `id="plan"`
 * inside the workspace, so the anchor resolves without a second navigation.
 *
 * The `?runId=` redirect in `ResearchPage` stays for bookmarks and links that
 * predate this, which is why its test stays too.
 */
export function liveResearchUrl(runId: string, opts?: { focusPlan?: boolean }): string {
  return `/app/run/${encodeURIComponent(runId)}${opts?.focusPlan ? '#plan' : ''}`;
}

/**
 * Back to the request page with a previous run's inputs restored.
 *
 * Cancelling at the plan gate used to call `applyRequestFormFromRun` on the
 * page the user was already on, because "cancel" means "not like that, let me
 * edit it" rather than "discard what I typed". A run now lives on its own
 * route with no form on it, so the request has to travel back by URL.
 */
export function requestPrefillUrl(runId: string): string {
  return `${RESEARCH_PAGE_PATH}?${REQUEST_PREFILL_PARAM}=${encodeURIComponent(runId)}`;
}

export function parsePrefillRunIdFromSearchParams(
  searchParams: URLSearchParams | { get: (key: string) => string | null }
): string | null {
  const raw = searchParams.get(REQUEST_PREFILL_PARAM)?.trim();
  return raw && raw.length > 0 ? raw : null;
}

/** Failed-run diagnostics page (manual / bookmark). */
export function failedRunReportUrl(runId: string): string {
  return `/app/reports/run/${runId}`;
}
