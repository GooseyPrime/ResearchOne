/** Canonical SPA target for opening a completed run’s report in the dossier shell. */
export function dossierReportUrlForRun(runId: string): string {
  return `/app/dossiers/${runId}#report`;
}
