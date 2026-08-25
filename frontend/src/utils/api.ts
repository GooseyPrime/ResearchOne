import axios, { type InternalAxiosRequestConfig } from 'axios';
import { applyApiRateLimitInterceptor } from './apiRateLimit';
import { getClerkJwtForApi } from './clerkSession';

const API_PREFIX = '/api';

export function resolveApiBaseUrl(viteApiBaseUrl?: string): string {
  const base = (viteApiBaseUrl ?? '').trim().replace(/\/+$/, '');
  if (!base) return API_PREFIX;
  return base.endsWith(API_PREFIX) ? base : `${base}${API_PREFIX}`;
}

const api = axios.create({
  baseURL: resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
  timeout: 60000,
  headers: { 'Content-Type': 'application/json' },
});

applyApiRateLimitInterceptor(api);

api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const token = await getClerkJwtForApi();
  if (token) {
    config.headers.set('Authorization', `Bearer ${token}`);
  }
  return config;
});

/**
 * Same base URL and rate-limit behavior as `api`, but **no** Clerk JWT
 * interceptor. Use only for intentionally anonymous public telemetry
 * (e.g. Rule 26 I-2 landing persona events).
 */
export const publicApi = axios.create({
  baseURL: resolveApiBaseUrl(import.meta.env.VITE_API_BASE_URL),
  timeout: 15000,
  headers: { 'Content-Type': 'application/json' },
});

applyApiRateLimitInterceptor(publicApi);

export default api;

/** Idempotent: ensures `users` row exists / email refreshed (race with Clerk webhook). */
export const syncLocalUserFromClerk = () =>
  api.post<{ ok: boolean; userId: string }>('/auth/sync').then((r) => r.data);

/** Extract a human-readable message from any error, preferring the backend's
 *  `error` / `message` field over the generic Axios "Request failed…" string. */
export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (data) {
      const error = typeof data.error === 'string' ? data.error : '';
      const detail = typeof data.detail === 'string' ? data.detail : '';
      if (error && detail) return `${error}: ${detail}`;
      if (error) return error;
      if (detail) return detail;
      if (typeof data.message === 'string' && data.message) return data.message;
    }
  }
  return err instanceof Error ? err.message : String(err);
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CorpusStats {
  source_count: number;
  document_count: number;
  chunk_count: number;
  embedding_count: number;
  claim_count: number;
  contradiction_count: number;
  open_contradiction_count: number;
  finalized_report_count: number;
  active_run_count: number;
  db_size: string;
}

export interface Source {
  id: string;
  url: string;
  title: string;
  source_type: string;
  tags: string[];
  chunk_count: number;
  embedding_count: number;
  ingested_at: string;
  published_at?: string;
}

export type ResearchObjective =
  | 'GENERAL_EPISTEMIC_RESEARCH'
  | 'INVESTIGATIVE_SYNTHESIS'
  | 'NOVEL_APPLICATION_DISCOVERY'
  | 'PATENT_GAP_ANALYSIS'
  | 'ANOMALY_CORRELATION';

/** Must stay aligned with `VALID_EXPORT_STYLES` / `ReportExportButton` export styles. */
export type CitationStyleSlug =
  | 'mla'
  | 'apa'
  | 'chicago-author-date'
  | 'chicago-note'
  | 'ieee'
  | 'harvard';

export const CITATION_STYLE_OPTIONS: { value: CitationStyleSlug; label: string }[] = [
  { value: 'mla', label: 'MLA (9th ed.)' },
  { value: 'apa', label: 'APA (7th ed.)' },
  { value: 'chicago-author-date', label: 'Chicago — Author/Date' },
  { value: 'chicago-note', label: 'Chicago — Notes & Bibliography' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'harvard', label: 'Harvard' },
];

export interface ResearchProgressEvent {
  runId?: string;
  stage: string;
  percent: number;
  message: string;
  detail?: string;
  substep?: string;
  timestamp?: string;
  model?: string;
  tokenUsage?: { prompt: number; completion: number };
  sourceCount?: number;
  chunkCount?: number;
  // `run_quality_gate_failed` is emitted by the backend for a run that produced
  // a report but did not pass its gates. It is deliberately distinct from
  // `run_completed`: treating the two as the same is what showed a success
  // notification on a contract-failed run (PR #212).
  eventType?:
    | 'progress'
    | 'run_started'
    | 'run_failed'
    | 'run_completed'
    | 'run_quality_gate_failed'
    | 'run_resumed'
    | 'run_aborted';
  failure?: {
    errorMessage?: string;
    retryable?: boolean;
    failureMeta?: Record<string, unknown>;
  };
}

export interface ResearchSupplementalAttachment {
  kind: 'url' | 'file';
  url?: string;
  filename?: string;
  mimetype?: string;
  ingestion_job_id: string;
}

export interface ResearchRun {
  id: string;
  /**
   * Human-readable reference (`R1-YYYYMMDD-HHMM-XXXXX-C`) assigned to every run
   * including failures. This is the value a user quotes to support, so it must
   * be visible to them. Absent on deployments where migration 055 has not
   * applied yet.
   */
  run_ref?: string | null;
  /**
   * The run's human-facing name, written server-side at the plan gate
   * (migration 057). `title` is NOT this: the API sets it to the raw prompt
   * truncated to 200 characters, which is why every surface that reached for a
   * run's name rendered the prompt. Null until the planner has produced a topic
   * summary, and absent entirely on deployments where 057 has not applied yet —
   * resolve it through `runDisplayTitle`, never directly.
   */
  display_title?: string | null;
  title: string;
  query: string;
  supplemental?: string;
  supplemental_attachments?: ResearchSupplementalAttachment[];
  engine_version?: string | null;
  requested_research_objective?: 'AUTO' | ResearchObjective | string | null;
  research_objective?: ResearchObjective | string | null;
  status:
    | 'queued'
    | 'running'
    | 'plan_pending_confirmation'
    | 'completed'
    | 'failed'
    | 'cancelled'
    | 'aborted';
  retry_attempts?: number | null;
  retry_budget?: number | null;
  error_message?: string;
  failed_stage?: string;
  failure_meta?: Record<string, unknown>;
  progress_stage?: string | null;
  progress_percent?: number | null;
  progress_message?: string | null;
  progress_updated_at?: string | null;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  plan?: Record<string, unknown>;
  model_log?: unknown[];
  progress_events?: ResearchProgressEvent[];
  model_overrides?: Record<string, unknown>;
  model_ensemble?: Record<string, unknown>;
  /** Bibliography style chosen at run start (`research_runs.citation_style`). */
  citation_style?: string | null;
  /** Linked report when the run completed (enables spinoff from run list). */
  report_id?: string | null;
  /** Spinoff lineage when this run was forked from a prior report. */
  spinoff_from_report_id?: string | null;
}

export interface SpinoffPrefill {
  fromReportId: string;
  fromRunId?: string;
  reportTitle: string;
  query: string;
  supplemental?: string | null;
  engineVersion?: 'v1' | 'v2' | string | null;
  researchObjective?: ResearchObjective | string | null;
  citationStyle?: CitationStyleSlug | string | null;
  targetWordCount?: number | null;
  modelOverrides?: Record<string, unknown> | null;
  filterTags?: string[];
}

export interface SystemHealth {
  service?: string;
  version?: string;
  gitSha?: string;
  buildSha?: string;
  builtAt?: string | null;
  nodeEnv?: string;
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  checks?: {
    api: { ok: boolean; latencyMs?: number };
    db: { ok: boolean; latencyMs?: number };
    redis: { ok: boolean; latencyMs?: number };
    queue: { ok: boolean; latencyMs?: number };
    openrouter: { ok: boolean; latencyMs?: number; modelProbe?: string };
    discovery: { ok: boolean; provider?: string; ready?: boolean; reason?: string };
    exports: { ok: boolean; writable?: boolean };
    websocket: { ok: boolean };
  };
  integrations?: {
    parallel?: { configured: boolean; ok: boolean; latencyMs?: number; reason?: string };
    scite?: { configured: boolean; ok: boolean; latencyMs?: number; reason?: string };
  };
  restartAvailable?: boolean;
}

export interface Report {
  id: string;
  /** Present when migration 029 applied — creator's Clerk user id */
  owner_user_id?: string | null;
  /** Present when migration 029 applied — org scope for shared reports */
  org_id?: string | null;
  root_report_id?: string;
  parent_report_id?: string;
  version_number?: number;
  run_id?: string;
  title: string;
  query: string;
  status: 'draft' | 'generating' | 'under_review' | 'finalized' | 'archived';
  executive_summary?: string;
  conclusion?: string;
  falsification_criteria?: string;
  unresolved_questions?: string[];
  recommended_queries?: string[];
  contradiction_count: number;
  source_count: number;
  chunk_count: number;
  finalized_at?: string;
  created_at: string;
  report_expires_at?: string | null;
  workspace_expires_at?: string | null;
  workspace_purged_at?: string | null;
  retention_status?: string | null;
  has_active_living_report?: boolean;
  sections?: ReportSection[];
  metadata?: Record<string, unknown> & {
    plain_language_markdown?: string;
    /** Wave 5.2 — intent output template id */
    output_template_id?: string;
    orchestration_intent?: string;
    skeptic_mode?: string;
    skeptic_annotations?: unknown[];
    research_request?: {
      query?: string;
      supplemental?: string;
      supplemental_attachments?: ResearchSupplementalAttachment[];
    };
  };
}

/** Wave 5.0 — aligns with `GET /api/dossiers` (backend `Dossier` type). */
export interface DossierRequest {
  query: string;
  supplemental: string | null;
  supplementalAttachments: unknown;
  createdAt: string;
}

export interface DossierPlan {
  planId: string | null;
  intent: string;
  /** Wave 5.1+ — `research_plans.orchestration_profile` label */
  orchestrationProfile?: string | null;
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
  /** Wave 5.3 — source-class counts for retrieved chunks (orthogonal to tiers). */
  sourceClassBreakdown: Record<string, unknown> | null;
  steelmanPassCount: number | null;
}

export interface Dossier {
  dossierId: string;
  runId: string;
  runStatus: string;
  /** Gate status from failure_meta — more specific than runStatus for degraded/failed runs. */
  gateStatus?: string | null;
  request: DossierRequest;
  plan: DossierPlan;
  report: DossierReportLink;
  stats: DossierStats;
}

export interface DossierListRow {
  dossierId: string;
  runId: string;
  runStatus: string;
  /** Gate status from failure_meta — more specific than runStatus for degraded/failed runs. */
  gateStatus?: string | null;
  requestQuery: string;
  /** `research_runs.display_title` (migration 057). Absent on pre-057 rows. */
  displayTitle?: string | null;
  /** `research_runs.run_ref` — last resort in the title chain. Absent on pre-057 rows. */
  runRef?: string | null;
  planIntent: string | null;
  dossierCreatedAt: string;
  reportId: string | null;
  reportTitle: string | null;
  sourcesCitedCount: number | null;
  totalDurationMs: number | null;
  /** Wave 5.5+ — most recent activity (revision, run update, etc.). */
  lastActivityAt?: string | null;
  versionNumber?: number | null;
  isSpinoff?: boolean;
  isRevised?: boolean;
  spinoffFromReportId?: string | null;
  engineVersion?: string | null;
}

export interface DossierListResult {
  rows: DossierListRow[];
  total: number;
  page: number;
  pageSize: number;
}

export type DossierSortBy = 'dossier_created_at' | 'last_activity_at';

export type DossierListParams = {
  page?: number;
  pageSize?: number;
  intent?: string;
  status?: string;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  sortBy?: DossierSortBy;
};

/** Revision supplemental attachment audit row (POST /reports/:id/revisions response). */
export interface RevisionAttachmentAudit {
  kind: 'url' | 'file';
  url?: string;
  filename?: string;
  mimetype?: string;
  ingestion_job_id: string;
  fetch_status?: 'success' | 'failed';
  fetch_error?: string;
  ingestion_status?: string;
  extractedChars?: number;
  inline_status?: 'included' | 'skipped' | 'failed';
  retrieval_status?: 'queued' | 'completed' | 'failed' | 'pending';
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

export interface DossierTimelineResult {
  rows: DossierTimelineRow[];
  total: number;
  page: number;
  pageSize: number;
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

export interface ReportRevision {
  id: string;
  report_id: string;
  base_report_id: string;
  revised_report_id: string;
  revision_number: number;
  rationale?: string;
  initiated_by: string;
  initiated_by_type: string;
  status: string;
  created_at: string;
}

export interface ReportRevisionDetail extends ReportRevision {
  change_plan?: Record<string, unknown>;
  sections: Array<{
    id: string;
    section_type: string;
    section_title: string;
    before_content: string;
    after_content: string;
    change_type: string;
  }>;
  diffs: Array<{
    id: string;
    section_type: string;
    before_content: string;
    after_content: string;
    diff_metadata: Record<string, unknown>;
  }>;
}

export interface ReportSection {
  id: string;
  section_type: string;
  title: string;
  content: string;
  section_order: number;
}

export interface IngestionJob {
  id: string;
  url?: string;
  file_name?: string;
  source_type: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  source_id?: string | null;
  metadata?: Record<string, unknown>;
  imported_via?: string | null;
  discovered_by_run_id?: string | null;
}

export interface AtlasExport {
  id: string;
  label: string;
  description?: string;
  filter_tags: string[];
  chunk_count: number;
  export_path?: string;
  created_at: string;
}

export interface Claim {
  id: string;
  claim_text: string;
  evidence_tier: string;
  confidence: number;
  source_url?: string;
  source_title?: string;
  created_at: string;
}

export interface Contradiction {
  id: string;
  claim_a_id: string;
  claim_b_id: string;
  claim_a_text?: string;
  claim_b_text?: string;
  description: string;
  severity: string;
  resolved: boolean;
  created_at: string;
}

export interface WalletLedgerEntry {
  id: number;
  amount_cents: number;
  entry_type: 'credit' | 'debit';
  description: string;
  idempotency_key: string;
  stripe_checkout_session_id: string | null;
  created_at: string;
}

export interface WalletSummary {
  balanceCents: number;
  currency: string;
  history: WalletLedgerEntry[];
}

export interface UserSubscription {
  tier: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
}

// ─── API Functions ────────────────────────────────────────────────────────────

export const getStats = () => api.get<CorpusStats>('/corpus/stats').then(r => r.data);

export const getSources = (params?: { type?: string; search?: string }) =>
  api.get<Source[]>('/sources', { params }).then(r => r.data);

export const deleteSource = (id: string) => api.delete(`/sources/${id}`);

export const getReports = (params?: { status?: string; search?: string }) =>
  api.get<Report[]>('/reports', { params }).then(r => r.data);

export const getDossiers = (params?: DossierListParams) =>
  api.get<DossierListResult>('/dossiers', { params }).then((r) => r.data);

export const getDossier = (id: string) => api.get<Dossier>(`/dossiers/${id}`).then((r) => r.data);

export const getDossierReportHistory = (dossierId: string) =>
  api.get<{ entries: DossierReportHistoryEntry[] }>(`/dossiers/${dossierId}/report-history`).then((r) => r.data);

export const getDossierSpinoffs = (dossierId: string) =>
  api.get<{ spinoffs: DossierSpinoffEntry[] }>(`/dossiers/${dossierId}/spinoffs`).then((r) => r.data);

export const getDossierSources = (dossierId: string) =>
  api.get<{ sources: DossierSourceEntry[] }>(`/dossiers/${dossierId}/sources`).then((r) => r.data);

export const fetchDossierTimeline = (params?: {
  page?: number;
  pageSize?: number;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  status?: string;
}) => api.get<DossierTimelineResult>('/dossiers/timeline', { params }).then((r) => r.data);

export const getReport = (id: string) => api.get<Report>(`/reports/${id}`).then(r => r.data);

/** @deprecated Prefer RevisionAttachmentAudit from revision responses. */
export interface RevisionSupplementalAttachmentOutcome {
  kind?: string;
  url?: string;
  filename?: string;
  fetch_status?: 'ok' | 'failed' | 'success';
  error?: string;
}

export const createReportRevision = (id: string, data: {
  requestText: string;
  rationale?: string;
  initiatedBy?: string;
  initiatedByType?: string;
  /** Files attached to support the revision request. Sent as multipart;
   *  ingested into the corpus and inlined into revision prompts so the
   *  models can review them on this revision call. */
  revisionFiles?: File[];
  revisionUrls?: string[];
}) => {
  const hasFiles = data.revisionFiles && data.revisionFiles.length > 0;
  const hasUrls = data.revisionUrls && data.revisionUrls.length > 0;
  if (hasFiles || hasUrls) {
    const form = new FormData();
    form.append('requestText', data.requestText);
    if (data.rationale) form.append('rationale', data.rationale);
    if (data.initiatedBy) form.append('initiatedBy', data.initiatedBy);
    if (data.initiatedByType) form.append('initiatedByType', data.initiatedByType);
    if (hasUrls) form.append('revisionUrls', JSON.stringify(data.revisionUrls));
    for (const f of data.revisionFiles ?? []) {
      form.append('files', f);
    }
    return api
      .post<{
        revisionId: string;
        revisedReportId: string;
        supplementalAttachments?: RevisionAttachmentAudit[];
      }>(`/reports/${id}/revisions`, form, {
        timeout: 900000,
      })
      .then((r) => r.data);
  }
  return api
    .post<{
      revisionId: string;
      revisedReportId: string;
      supplementalAttachments?: RevisionAttachmentAudit[];
    }>(`/reports/${id}/revisions`, data, { timeout: 900000 })
    .then((r) => r.data);
};

export const getReportRevisions = (id: string) =>
  api.get<ReportRevision[]>(`/reports/${id}/revisions`).then(r => r.data);

export const getReportRevision = (id: string, revisionId: string) =>
  api.get<ReportRevisionDetail>(`/reports/${id}/revisions/${revisionId}`).then(r => r.data);

/** Optional break-glass `x-admin-token`; omit in UI so Clerk JWT + ADMIN_USER_IDS authorize. */
function optionalAdminHeaders(adminToken?: string): { headers?: { 'x-admin-token': string } } {
  const t = adminToken?.trim();
  return t ? { headers: { 'x-admin-token': t } } : {};
}

export const publishReportFeatured = (id: string, adminToken?: string) =>
  api
    .post<{ ok: boolean; repo: string; path: string; branch: string; commitUrl: string | null }>(
      `/reports/${id}/publish-featured`,
      {},
      optionalAdminHeaders(adminToken)
    )
    .then(r => r.data);

export interface ResearchModelOptionsResponse {
  defaults: Record<string, string>;
  fallbacks: Record<string, string>;
  allowlist: Record<string, string[]>;
}

export interface StartResearchPayload {
  query: string;
  supplemental?: string;
  filterTags?: string[];
  modelOverrides?: Record<string, unknown>;
  researchObjective?: ResearchObjective;
  supplementalUrls?: string[];
  supplementalUrlCrawl?: { siteCrawl: boolean; crawlLayers: number };
  supplementalFiles?: File[];
  /** User-requested total report length in words. Server clamps to a safe range. */
  targetWordCount?: number;
  /** Citation style for academic exports (stored on the run for downstream formatting). */
  citationStyle?: CitationStyleSlug;
  /** Requested presentation formats for planning/report generation. */
  requestedFormats?: string[];
  /** Persist user intent even when objective routing remains automatic. */
  requestedResearchObjective?: 'AUTO' | ResearchObjective;
  /** Reserved methodology hint for future routing. */
  requestedMethodology?: string;
  /** Wave 5.4 — optional saved orchestration profile (paid tiers). */
  savedOrchestrationProfileId?: string;
  /** Per-run wallet add-ons (keys from billing add-on catalog). */
  addons?: string[];
}

export const startResearch = (data: StartResearchPayload) => {
  const { supplementalFiles, supplementalUrls, supplementalUrlCrawl, ...rest } = data;
  const hasFiles = supplementalFiles && supplementalFiles.length > 0;
  const hasSupplementalUrls = supplementalUrls && supplementalUrls.length > 0;

  if (hasFiles || hasSupplementalUrls || supplementalUrlCrawl) {
    const form = new FormData();
    form.append('query', rest.query);
    if (rest.supplemental) form.append('supplemental', rest.supplemental);
    if (rest.filterTags?.length) form.append('filterTags', JSON.stringify(rest.filterTags));
    if (rest.modelOverrides && Object.keys(rest.modelOverrides).length > 0) {
      form.append('modelOverrides', JSON.stringify(rest.modelOverrides));
    }
    if (rest.researchObjective) form.append('researchObjective', rest.researchObjective);
    if (typeof rest.targetWordCount === 'number') {
      form.append('targetWordCount', String(rest.targetWordCount));
    }
    if (rest.requestedFormats?.length) {
      form.append('requestedFormats', JSON.stringify(rest.requestedFormats));
    }
    if (rest.requestedResearchObjective) {
      form.append('requestedResearchObjective', rest.requestedResearchObjective);
    }
    if (rest.requestedMethodology) {
      form.append('requestedMethodology', rest.requestedMethodology);
    }
    if (rest.citationStyle) {
      form.append('citation_style', rest.citationStyle);
    }
    if (rest.savedOrchestrationProfileId) {
      form.append('savedOrchestrationProfileId', rest.savedOrchestrationProfileId);
    }
    if (rest.addons && rest.addons.length > 0) {
      form.append('addons', JSON.stringify(rest.addons));
    }
    if (hasSupplementalUrls) {
      form.append('supplementalUrls', JSON.stringify(supplementalUrls));
    }
    if (supplementalUrlCrawl) {
      form.append('supplementalUrlCrawl', JSON.stringify(supplementalUrlCrawl));
    }
    for (const f of supplementalFiles ?? []) {
      form.append('files', f);
    }
    return api
      .post<{
        runId: string;
        status: string;
        supplementalIngest?: import('./supplementalIngestNotifications').SupplementalIngestSummary;
      }>('/research', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  }

  return api
    .post<{
      runId: string;
      status: string;
      supplementalIngest?: import('./supplementalIngestNotifications').SupplementalIngestSummary;
    }>('/research', {
      ...rest,
      supplementalUrls: hasSupplementalUrls ? supplementalUrls : undefined,
      supplementalUrlCrawl,
      addons: rest.addons?.length ? rest.addons : undefined,
      requestedFormats: rest.requestedFormats?.length ? rest.requestedFormats : undefined,
      requestedResearchObjective: rest.requestedResearchObjective,
      requestedMethodology: rest.requestedMethodology,
    })
    .then((r) => r.data);
};

export const fetchSpinoffPrefill = (reportId: string) =>
  api.get<SpinoffPrefill>(`/reports/${reportId}/spinoff/prefill`).then((r) => r.data);

export const startResearchSpinoff = (fromReportId: string, data: StartResearchPayload) => {
  const { supplementalFiles, supplementalUrls, supplementalUrlCrawl, ...rest } = data;
  const hasFiles = supplementalFiles && supplementalFiles.length > 0;
  const hasSupplementalUrls = supplementalUrls && supplementalUrls.length > 0;

  if (hasFiles || hasSupplementalUrls || supplementalUrlCrawl) {
    const form = new FormData();
    form.append('fromReportId', fromReportId);
    form.append('query', rest.query);
    if (rest.supplemental) form.append('supplemental', rest.supplemental);
    if (rest.filterTags?.length) form.append('filterTags', JSON.stringify(rest.filterTags));
    if (rest.modelOverrides && Object.keys(rest.modelOverrides).length > 0) {
      form.append('modelOverrides', JSON.stringify(rest.modelOverrides));
    }
    if (rest.researchObjective) form.append('researchObjective', rest.researchObjective);
    if (typeof rest.targetWordCount === 'number') {
      form.append('targetWordCount', String(rest.targetWordCount));
    }
    if (rest.requestedFormats?.length) {
      form.append('requestedFormats', JSON.stringify(rest.requestedFormats));
    }
    if (rest.requestedResearchObjective) {
      form.append('requestedResearchObjective', rest.requestedResearchObjective);
    }
    if (rest.requestedMethodology) {
      form.append('requestedMethodology', rest.requestedMethodology);
    }
    if (rest.citationStyle) {
      form.append('citation_style', rest.citationStyle);
    }
    if (rest.savedOrchestrationProfileId) {
      form.append('savedOrchestrationProfileId', rest.savedOrchestrationProfileId);
    }
    if (rest.addons && rest.addons.length > 0) {
      form.append('addons', JSON.stringify(rest.addons));
    }
    if (hasSupplementalUrls) {
      form.append('supplementalUrls', JSON.stringify(supplementalUrls));
    }
    if (supplementalUrlCrawl) {
      form.append('supplementalUrlCrawl', JSON.stringify(supplementalUrlCrawl));
    }
    for (const f of supplementalFiles ?? []) {
      form.append('files', f);
    }
    return api
      .post<{
        runId: string;
        status: string;
        supplementalIngest?: import('./supplementalIngestNotifications').SupplementalIngestSummary;
      }>('/research/spinoff', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  }

  return api
    .post<{
      runId: string;
      status: string;
      supplementalIngest?: import('./supplementalIngestNotifications').SupplementalIngestSummary;
    }>('/research/spinoff', {
      fromReportId,
      ...rest,
      supplementalUrls: hasSupplementalUrls ? supplementalUrls : undefined,
      supplementalUrlCrawl,
      addons: rest.addons?.length ? rest.addons : undefined,
      requestedFormats: rest.requestedFormats?.length ? rest.requestedFormats : undefined,
      requestedResearchObjective: rest.requestedResearchObjective,
      requestedMethodology: rest.requestedMethodology,
    })
    .then((r) => r.data);
};

export const getResearchRuns = (params?: { status?: string }) =>
  api.get<ResearchRun[]>('/research', { params }).then(r => r.data);

export const getResearchRun = (id: string) =>
  api.get<ResearchRun>(`/research/${id}`).then(r => r.data);

/** Wave 5.1 — `GET /api/runs/:runId/plan` (dossier-shaped plan snapshot for the gate). */
export interface RunPlanGateResponse {
  runId: string;
  runStatus: string;
  plan: DossierPlan;
}

export const getRunPlanForGate = (runId: string) =>
  api.get<RunPlanGateResponse>(`/runs/${runId}/plan`).then((r) => r.data);

export const refineRunPlanAtGate = (runId: string, refinementInstruction: string) =>
  api
    .post<{
      ok: boolean;
      planId: string;
      revisedPlan: Record<string, unknown>;
      diffSummary?: string;
      intentChange?: boolean;
      refinementRounds: number;
    }>(`/runs/${runId}/plan/refine`, { refinementInstruction })
    .then((r) => r.data);

export const confirmRunPlanAtGate = (runId: string, planId?: string) =>
  api
    .post<{ ok: boolean; runId: string; planId: string; status: string }>(`/runs/${runId}/plan/confirm`, {
      ...(planId ? { planId } : {}),
    })
    .then((r) => r.data);

export const cancelRunPlanAtGate = (runId: string) =>
  api.post<{ ok: boolean; runId: string; status: string }>(`/runs/${runId}/plan/cancel`, {}).then((r) => r.data);

/** Wave 5.4 — plan refinement audit trail for a run. */
export interface PlanRevisionRow {
  id: string;
  revisionNumber: number;
  refinementPrompt: string | null;
  diffSummary: string | null;
  createdAt: string;
  createdBy: string | null;
  createdByEmail: string | null;
}

export const getRunPlanRevisions = (runId: string) =>
  api.get<{ runId: string; revisions: PlanRevisionRow[] }>(`/runs/${runId}/plan/revisions`).then((r) => r.data);

/** Wave 5.4 — account plan auto-confirm preferences + preview. */
export interface PlanPreferencesResponse {
  autoConfirmEnabled: boolean;
  autoConfirmThreshold: number;
  confirmedStreak: number;
  previewThreshold: number;
  previewSampleSize: number;
  previewHitRate: number | null;
}

export const getPlanPreferences = (previewThreshold?: number) =>
  api
    .get<PlanPreferencesResponse>('/auth/plan-preferences', {
      params: previewThreshold != null ? { previewThreshold } : undefined,
    })
    .then((r) => r.data);

export const patchPlanPreferences = (body: { autoConfirmEnabled?: boolean; autoConfirmThreshold?: number }) =>
  api.patch<PlanPreferencesResponse>('/auth/plan-preferences', body).then((r) => r.data);

export interface SavedOrchestrationProfile {
  id: string;
  userId: string;
  orgId: string | null;
  name: string;
  description: string | null;
  baseIntent: string;
  customizations: unknown;
  isShared: boolean;
  createdAt: string;
  updatedAt: string;
}

export const listSavedOrchestrationProfiles = () =>
  api.get<{ profiles: SavedOrchestrationProfile[] }>('/auth/saved-orchestration-profiles').then((r) => r.data);

export const createSavedOrchestrationProfile = (body: {
  name: string;
  description?: string | null;
  baseIntent: string;
  customizations?: unknown;
  isShared?: boolean;
  /** Ignored by the server — org context comes from the authenticated Clerk session. */
  orgId?: string | null;
}) => api.post<SavedOrchestrationProfile>('/auth/saved-orchestration-profiles', body).then((r) => r.data);

export const deleteSavedOrchestrationProfile = (id: string) =>
  api.delete<{ ok: boolean }>(`/auth/saved-orchestration-profiles/${encodeURIComponent(id)}`).then((r) => r.data);

export interface RunArtifacts {
  sources: Array<{
    id: string; title: string | null; url: string | null; source_type: string;
    tags: string[]; ingested_at: string;
  }>;
  claims: Array<{
    id: string; claim_text: string; evidence_tier: string | null; source_id: string | null;
  }>;
  checkpoints: Array<{
    stage: string; checkpoint_key: string; snapshot: Record<string, unknown>; created_at: string;
  }>;
  sourcesTotal: number;
  claimsTotal: number;
  progressEvents?: ResearchProgressEvent[];
  plan?: Record<string, unknown> | null;
  discoverySummary?: Record<string, unknown> | null;
  discoveryEvents?: Array<{
    phase: string; provider: string; query_text: string; result_count: number;
    selected_count: number; payload: Record<string, unknown>; created_at: string;
  }>;
  modelLog?: Array<Record<string, unknown>>;
  modelOverrides?: Record<string, unknown> | null;
  modelEnsemble?: Record<string, unknown> | null;
  reportId?: string | null;
}

export const getRunArtifacts = (id: string) =>
  api.get<RunArtifacts>(`/research/${id}/artifacts`).then(r => r.data);

export const getResearchModelOptions = () =>
  api.get<ResearchModelOptionsResponse>('/research/model-options').then(r => r.data);

export type EnsembleRolePair = { primary: string; fallback: string };

export interface ResearchV2EnsemblePresetsResponse {
  presets: Record<ResearchObjective, Record<string, EnsembleRolePair>>;
  allowlist: Record<string, string[]>;
}

export const getResearchV2EnsemblePresets = () =>
  api.get<ResearchV2EnsemblePresetsResponse>('/research/v2/ensemble-presets').then((r) => r.data);

export const cancelResearchRun = (id: string) =>
  api.post<{ ok: boolean; status: string }>(`/research/${id}/cancel`).then(r => r.data);

export const deleteResearchRun = (id: string) =>
  api.delete(`/research/${id}`).then(r => r.data);

export const retryResearchRunFromFailure = (id: string) =>
  api
    .post<{
      ok: boolean;
      status: string;
      retryAttempts?: number;
      retryBudget?: number;
      attemptsRemaining?: number;
    }>(`/research/${id}/retry-from-failure`)
    .then((r) => r.data);

export const getSystemHealth = () =>
  api.get<SystemHealth>('/health').then(r => r.data);

export const restartRuntime = (adminToken?: string) =>
  api.post('/admin/runtime/restart', {}, optionalAdminHeaders(adminToken)).then(r => r.data);

/** Session key for optional break-glass admin token (operators without Clerk allowlist). */
export const ADMIN_SESSION_TOKEN_KEY = 'researchone_admin_token';

export function readBreakGlassAdminTokenFromSession(): string | undefined {
  if (typeof sessionStorage === 'undefined') return undefined;
  const t = sessionStorage.getItem(ADMIN_SESSION_TOKEN_KEY)?.trim();
  return t || undefined;
}

export function writeBreakGlassAdminTokenToSession(token: string | null | undefined): void {
  if (typeof sessionStorage === 'undefined') return;
  const t = token?.trim();
  if (!t) sessionStorage.removeItem(ADMIN_SESSION_TOKEN_KEY);
  else sessionStorage.setItem(ADMIN_SESSION_TOKEN_KEY, t);
}

export interface RuntimeLogResponse {
  stream: 'out' | 'err';
  lines: number;
  content: string;
  truncated: boolean;
  resolvedPath?: string;
  triedPaths?: string[];
  hint?: string;
}

export const getRuntimeLogs = (adminToken: string | undefined, opts?: { stream?: 'out' | 'err'; lines?: number }) =>
  api
    .get<RuntimeLogResponse>('/admin/runtime/logs', {
      params: {
        stream: opts?.stream === 'err' ? 'err' : 'out',
        lines: opts?.lines ?? 500,
      },
      ...optionalAdminHeaders(adminToken),
    })
    .then(r => r.data);

export interface ModelOverrideEntry {
  primary?: string;
  fallback?: string;
}

export interface AdminModelsResponse {
  defaults: Record<string, unknown>;
  overrides: Record<string, ModelOverrideEntry>;
  embeddingOverride: string | null;
}

export const getAdminModels = (adminToken?: string) =>
  api.get<AdminModelsResponse>('/admin/models', optionalAdminHeaders(adminToken)).then(r => r.data);

export const putAdminModels = (adminToken: string | undefined, body: Record<string, unknown>) =>
  api.put('/admin/models', body, optionalAdminHeaders(adminToken)).then(r => r.data);

/** Must match backend `CORPUS_CLEAR_CONFIRM_PHRASE` (admin corpus clear). */
export const CORPUS_CLEAR_CONFIRM_PHRASE = 'DELETE ALL CORPUS DATA';

export interface CorpusClearResponse {
  ok: boolean;
  deleted: {
    claims: number;
    sources: number;
    ingestion_jobs: number;
  };
}

export const clearCorpus = (adminToken: string | undefined, body: { confirmPhrase: string }) =>
  api.post<CorpusClearResponse>('/admin/corpus/clear', body, optionalAdminHeaders(adminToken)).then(r => r.data);

export interface DeleteCorpusByIngestionJobsResponse {
  ok: boolean;
  deletedSourceIds: string[];
  deletedSourcesCount: number;
  skippedJobIds: string[];
}

export const deleteCorpusByIngestionJobs = (adminToken: string | undefined, body: { jobIds: string[] }) =>
  api
    .post<DeleteCorpusByIngestionJobsResponse>('/admin/corpus/delete-by-ingestion-jobs', body, optionalAdminHeaders(adminToken))
    .then(r => r.data);

export interface DeleteCorpusByResearchRunResponse {
  ok: boolean;
  runId: string;
  deletedSourceIds: string[];
  deletedSourcesCount: number;
}

export const deleteCorpusByResearchRun = (adminToken: string | undefined, body: { runId: string }) =>
  api
    .post<DeleteCorpusByResearchRunResponse>('/admin/corpus/delete-by-research-run', body, optionalAdminHeaders(adminToken))
    .then(r => r.data);

export const ingestUrl = (data: {
  url: string;
  tags?: string[];
  metadata?: Record<string, unknown>;
  siteCrawl?: boolean;
  crawlLayers?: number;
}) => api.post<{ jobId: string; status: string }>('/ingestion/url', data).then(r => r.data);

export const ingestText = (data: { text: string; title?: string; tags?: string[] }) =>
  api.post<{ jobId: string; status: string }>('/ingestion/text', data).then(r => r.data);

/** Default corpus upload cap (mirrors backend MAX_FILE_SIZE_MB). */
export const INGESTION_MAX_FILE_SIZE_MB = 50;

export const ingestFile = (file: File, tags?: string[]) => {
  const formData = new FormData();
  formData.append('file', file);
  if (tags) formData.append('tags', JSON.stringify(tags));
  // Let Axios set multipart boundary — a bare Content-Type breaks the body.
  return api
    .post<{ jobId: string; status: string }>('/ingestion/file', formData, {
      timeout: 120_000,
    })
    .then((r) => r.data);
};

export const getIngestionJobs = () =>
  api.get<IngestionJob[]>('/ingestion/jobs').then(r => r.data);

export const getAtlasExports = () =>
  api.get<AtlasExport[]>('/atlas/exports').then(r => r.data);

export const triggerAtlasExport = (data: { label: string; description?: string; filterTags?: string[] }) =>
  api.post<{ exportId: string; status: string }>('/atlas/export', data).then(r => r.data);

export const triggerNomicUpload = (exportId: string, data?: { datasetSlug?: string }) =>
  api.post<{ ok: boolean; datasetUrl: string; uploaded: number }>(`/atlas/exports/${exportId}/nomic-upload`, data || {}).then(r => r.data);

export interface AtlasPoint {
  id: string;
  text: string;
  source_url: string;
  source_title: string;
  tags: string[];
  evidence_tier: string | null;
  chunk_index: number;
  x: number;
  y: number;
}

export const getAtlasPoints = (params?: { limit?: number | 'full'; tags?: string }) =>
  api.get<AtlasPoint[]>('/atlas/points', { params }).then(r => r.data);

// Total embedded chunk count (optionally filtered by tag). Used to show
// "rendering N of M" on the in-browser embedding atlas so the user knows
// when their selected limit is truncating the live corpus.
export const getAtlasEmbeddedCount = (params?: { tags?: string }) =>
  api.get<{ count: number }>('/atlas/embedded-count', { params }).then(r => r.data);

export interface GraphNode {
  id: string;
  type: 'source' | 'claim';
  label: string;
  sub?: string;
  evidence_tier?: string | null;
  tags?: string[];
  url?: string;
  /** Publisher hostname bucket for graph coloring (sources / stakeholders). */
  group_key?: string;
  source_type?: string;
  weight?: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: 'contains' | 'contradicts';
  weight?: number;
}

export const getKnowledgeGraph = (params?: { runId?: string; limit?: number }) =>
  api.get<{ nodes: GraphNode[]; edges: GraphEdge[] }>('/graph', { params }).then(r => r.data);

export const getClaims = (params?: { tier?: string; search?: string }) =>
  api.get<Claim[]>('/corpus/claims', { params }).then(r => r.data);

export interface TierCount {
  evidence_tier: string;
  count: number;
}

export const getClaimTierDistribution = () =>
  api.get<TierCount[]>('/corpus/tier-distribution').then(r => r.data);

export const getContradictions = (params?: { resolved?: boolean }) =>
  api.get<Contradiction[]>('/corpus/contradictions', { params }).then(r => r.data);

export const getWalletSummary = () =>
  api.get<WalletSummary>('/billing/wallet').then((r) => r.data);

export const getSubscription = () =>
  api.get<UserSubscription>('/billing/subscription').then((r) => r.data);

// ─── Living Reports / Parallel Monitor (WO T) ─────────────────────────────────

export type ReportMonitorKind = 'living_report' | 'reverse_citation_watch';

export interface ReportMonitorRow {
  id: string;
  report_id: string;
  user_id: string;
  org_id: string | null;
  monitor_kind: ReportMonitorKind;
  parallel_monitor_id: string;
  query_def: Record<string, unknown>;
  status: string;
  stripe_subscription_id: string | null;
  stripe_subscription_item_id: string | null;
  expires_at?: string | null;
  auto_renew?: boolean;
}

export interface MonitorTokenBalance {
  tokenBalance: number;
  autoTopupEnabled: boolean;
  autoTopupPackageId: string | null;
}

export interface MonitorTokenPackage {
  id: string;
  label: string;
  tokenCount: number;
  priceCents: number;
  priceId: string;
}

export const MONITOR_TOKENS_QUERY_KEY = ['billing-monitor-tokens'] as const;

export interface MonitorEventRow {
  id: string;
  event_kind: string;
  webhook_event_id: string | null;
  payload: Record<string, unknown> | null;
  revision_id: string | null;
  created_at: string;
}

export const listReportMonitors = (reportId: string) =>
  api.get<{ monitors: ReportMonitorRow[] }>(`/reports/${reportId}/monitors`).then((r) => r.data);

export const createMonitorCheckoutSession = (reportId: string, monitorKind: ReportMonitorKind) =>
  api
    .post<{ checkoutUrl: string | null; sessionId: string }>(`/reports/${reportId}/monitors`, {
      monitorKind,
    })
    .then((r) => r.data);

export const getMonitorTokenBalance = () =>
  api.get<MonitorTokenBalance>('/billing/monitor-tokens').then((r) => r.data);

export const listMonitorTokenPackages = () =>
  api.get<{ packages: MonitorTokenPackage[] }>('/billing/monitor-tokens/packages').then((r) => r.data);

export const createMonitorTokenCheckout = (packageId: string) =>
  api
    .post<{ checkoutUrl: string | null; sessionId: string }>('/billing/monitor-tokens/checkout', {
      packageId,
    })
    .then((r) => r.data);

export const updateMonitorTokenPreferences = (body: {
  autoTopupEnabled?: boolean;
  autoTopupPackageId?: string | null;
}) => api.patch<MonitorTokenBalance>('/billing/monitor-tokens/preferences', body).then((r) => r.data);

export const activateLivingReportMonitor = (
  reportId: string,
  options?: { autoRenew?: boolean },
) =>
  api
    .post<{ monitorId: string; expiresAt: string; tokenBalance: number }>(
      `/reports/${reportId}/monitors`,
      { monitorKind: 'living_report', autoRenew: options?.autoRenew },
    )
    .then((r) => r.data);

export const toggleLivingReportMonitor = (
  monitorId: string,
  body: { active: boolean; autoRenew?: boolean },
) =>
  api
    .post<{ monitor: ReportMonitorRow; tokenBalance: number }>(`/monitors/${monitorId}/toggle`, body)
    .then((r) => r.data);

export const setLivingReportAutoRenew = (monitorId: string, autoRenew: boolean) =>
  api
    .patch<{ monitor: ReportMonitorRow }>(`/monitors/${monitorId}/auto-renew`, { autoRenew })
    .then((r) => r.data);

export const listUserMonitors = () =>
  api.get<{ monitors: ReportMonitorRow[] }>('/monitors').then((r) => r.data);

export const pauseUserMonitor = (monitorId: string) =>
  api.post<{ ok: boolean }>(`/monitors/${monitorId}/pause`).then((r) => r.data);

export const resumeUserMonitor = (monitorId: string) =>
  api.post<{ ok: boolean }>(`/monitors/${monitorId}/resume`).then((r) => r.data);

export const cancelUserMonitor = (monitorId: string) =>
  api.delete<{ ok: boolean }>(`/monitors/${monitorId}`).then((r) => r.data);

export const listMonitorEventsApi = (monitorId: string) =>
  api.get<{ events: MonitorEventRow[] }>(`/monitors/${monitorId}/events`).then((r) => r.data);

export type UserNotificationKind = 'payment_failed' | 'subscription_canceled' | 'system';

export interface UserNotificationRow {
  id: string;
  kind: UserNotificationKind;
  title: string;
  body: string | null;
  cta_path: string | null;
  read_at: string | null;
  created_at: string;
}

export const listUserNotificationsApi = () =>
  api.get<{ notifications: UserNotificationRow[] }>('/notifications').then((r) => r.data);

export const markNotificationReadApi = (id: string) =>
  api.post<{ ok: boolean }>(`/notifications/${id}/read`).then((r) => r.data);

/**
 * Resolve an export file download URL, supporting cross-origin Vercel + Emma deployments.
 * Falls back to same-origin /exports path if VITE_EXPORTS_BASE_URL is not set.
 */
export function resolveExportUrl(exportPath: string): string {
  const base = import.meta.env.VITE_EXPORTS_BASE_URL || '';
  // exportPath comes from the Linux backend (POSIX paths only) -- forward-slash split is correct
  const filename = exportPath.split('/').pop() ?? exportPath;
  return base ? `${base}/exports/${filename}` : `/exports/${filename}`;
}
