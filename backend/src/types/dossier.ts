/** Wave 5.0 — Dossier read models (API + v_dossier). Intent expands in Wave 5.1. */
export type PlanStatus = 'legacy' | 'draft' | 'pending_confirmation' | 'confirmed' | 'superseded';
export type DossierIntent = 'legacy';

export interface DossierRequest {
  query: string;
  supplemental: string | null;
  supplementalAttachments: unknown;
  createdAt: string;
}

export interface DossierPlan {
  planId: string | null;
  intent: string;
  orchestrationProfile: string | null;
  planSummary: string | null;
  planPayload: Record<string, unknown>;
  planStatus: string | null;
  refinementRounds: number | null;
}

export interface DossierReportLink {
  reportId: string | null;
  title: string | null;
  status: string | null;
  finalizedAt: string | null;
}

export interface DossierStats {
  totalDurationMs: number | null;
  tokensInput: number | null;
  tokensOutput: number | null;
  sourcesRetrievedCount: number | null;
  sourcesCitedCount: number | null;
  citationDensity: number | null;
  skepticAnnotationsCount: number | null;
  contradictionsCount: number | null;
  refinementRounds: number | null;
  agentsRan: unknown;
  agentsSkipped: unknown;
  stageDurations: unknown;
  modelsUsed: unknown;
  estimatedCostCents: number | null;
  actualCostCents: number | null;
  reportEvidenceTierSummary: Record<string, unknown> | null;
  /** Wave 5.3 — counts of retrieved chunks by orthogonal source-class axis (JSON from DB). */
  sourceClassBreakdown: Record<string, unknown> | null;
  steelmanPassCount: number | null;
}

export interface Dossier {
  dossierId: string;
  runId: string;
  runStatus: string;
  request: DossierRequest;
  plan: DossierPlan;
  report: DossierReportLink;
  stats: DossierStats;
}

export type DossierSortBy = 'dossier_created_at' | 'last_activity_at';

export interface DossierListFilters {
  page: number;
  pageSize: number;
  intent?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: DossierSortBy;
}

export interface DossierListRow {
  dossierId: string;
  runId: string;
  runStatus: string;
  requestQuery: string;
  planIntent: string | null;
  dossierCreatedAt: string;
  reportId: string | null;
  reportTitle: string | null;
  sourcesCitedCount: number | null;
  totalDurationMs: number | null;
  /** Wave 5.5+ — most recent activity (revision, run update, etc.). */
  lastActivityAt: string | null;
  versionNumber: number | null;
  isSpinoff: boolean;
  isRevised: boolean;
  spinoffFromReportId: string | null;
  engineVersion: string | null;
}

export interface DossierReportHistoryEntry {
  reportId: string;
  versionNumber: number;
  title: string;
  status: string;
  parentReportId: string | null;
  revisionNumber: number | null;
  createdAt: string;
  finalizedAt: string | null;
}

export interface DossierReportHistoryResult {
  entries: DossierReportHistoryEntry[];
}

export interface DossierSpinoffEntry {
  runId: string;
  dossierId: string;
  query: string;
  runStatus: string;
  engineVersion: string | null;
  reportId: string | null;
  spinoffFromReportId: string | null;
  createdAt: string;
}

export interface DossierSpinoffsResult {
  spinoffs: DossierSpinoffEntry[];
}

export interface DossierSourceEntry {
  sourceId: string;
  title: string | null;
  url: string | null;
  sourceType: string | null;
  ingestionStatus: string | null;
  fetchStatus: string | null;
  citedInReport: boolean;
  discoveredByRunId: string | null;
  chunkCount: number | null;
}

export interface DossierSourcesResult {
  sources: DossierSourceEntry[];
}

export type DossierTimelineEventType =
  | 'initial_run'
  | 'report_revision'
  | 'research_spinoff'
  | 'plan_refinement';

export interface DossierTimelineRow {
  occurredAt: string;
  eventType: DossierTimelineEventType | string;
  dossierId: string | null;
  runId: string | null;
  reportId: string | null;
  query: string | null;
  revisionNumber: number | null;
  engineVersion: string | null;
  runStatus: string | null;
}

export interface DossierTimelineFilters {
  page: number;
  pageSize: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface DossierTimelineResult {
  rows: DossierTimelineRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DossierListResult {
  rows: DossierListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DossierAuthContext {
  userId: string;
  orgId: string | null;
}
