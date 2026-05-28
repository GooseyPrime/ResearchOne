/** Passed via React Router location state when opening the revision workspace. */
export type ReportRevisionRequestState = {
  requestText: string;
  rationale?: string;
  revisionFiles?: File[];
  revisionUrls?: string[];
};

function isFileArray(value: unknown): value is File[] {
  return Array.isArray(value) && value.every((item) => item instanceof File);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

export function isReportRevisionRequestState(value: unknown): value is ReportRevisionRequestState {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  if (typeof v.requestText !== 'string' || v.requestText.trim().length === 0) return false;
  if (v.rationale !== undefined && typeof v.rationale !== 'string') return false;
  if (v.revisionFiles !== undefined && !isFileArray(v.revisionFiles)) return false;
  if (v.revisionUrls !== undefined && !isStringArray(v.revisionUrls)) return false;
  return true;
}
