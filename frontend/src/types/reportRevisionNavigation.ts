/** Passed via React Router location state when opening the revision workspace. */
export type ReportRevisionRequestState = {
  requestText: string;
  rationale?: string;
  revisionFiles?: File[];
  revisionUrls?: string[];
};

export function isReportRevisionRequestState(value: unknown): value is ReportRevisionRequestState {
  if (!value || typeof value !== 'object') return false;
  const v = value as ReportRevisionRequestState;
  return typeof v.requestText === 'string' && v.requestText.trim().length > 0;
}
