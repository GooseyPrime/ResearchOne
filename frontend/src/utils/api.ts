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

export default api;

/** Extract a human-readable message from any error, preferring the backend's
 *  `error` / `message` field over the generic Axios "Request failed…" string. */
export function extractApiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as Record<string, unknown> | undefined;
    if (data) {
      if (typeof data.error === 'string' && data.error) return data.error;
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
  eventType?: 'progress' | 'run_started' | 'run_failed' | 'run_completed' | 'run_resumed' | 'run_aborted';
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
  title: string;
  query: string;
  supplemental?: string;
  supplemental_attachments?: ResearchSupplementalAttachment[];
  engine_version?: string | null;
  research_objective?: ResearchObjective | string | null;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'aborted';
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
  checks: {
    api: { ok: boolean; latencyMs?: number };
    db: { ok: boolean; latencyMs?: number };
    redis: { ok: boolean; latencyMs?: number };
    queue: { ok: boolean; latencyMs?: number };
    openrouter: { ok: boolean; latencyMs?: number; modelProbe?: string };
    discovery: { ok: boolean; provider?: string; ready?: boolean; reason?: string };
    exports: { ok: boolean; writable?: boolean };
    websocket: { ok: boolean };
  };
  restartAvailable: boolean;
}

export interface Report {
  id: string;
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
  sections?: ReportSection[];
  metadata?: Record<string, unknown> & {
    plain_language_markdown?: string;
    research_request?: {
      query?: string;
      supplemental?: string;
      supplemental_attachments?: ResearchSupplementalAttachment[];
    };
  };
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

export const getReport = (id: string) => api.get<Report>(`/reports/${id}`).then(r => r.data);

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
      .post<{ revisionId: string; revisedReportId: string }>(`/reports/${id}/revisions`, form, {
        timeout: 900000,
      })
      .then((r) => r.data);
  }
  return api
    .post<{ revisionId: string; revisedReportId: string }>(`/reports/${id}/revisions`, data, { timeout: 900000 })
    .then((r) => r.data);
};

export const getReportRevisions = (id: string) =>
  api.get<ReportRevision[]>(`/reports/${id}/revisions`).then(r => r.data);

export const getReportRevision = (id: string, revisionId: string) =>
  api.get<ReportRevisionDetail>(`/reports/${id}/revisions/${revisionId}`).then(r => r.data);

export const publishReportFeatured = (id: string, adminToken: string) =>
  api
    .post<{ ok: boolean; repo: string; path: string; branch: string; commitUrl: string | null }>(
      `/reports/${id}/publish-featured`,
      {},
      { headers: { 'x-admin-token': adminToken } }
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
  engineVersion?: 'v2';
  researchObjective?: ResearchObjective;
  supplementalUrls?: string[];
  supplementalFiles?: File[];
  /** User-requested total report length in words. Server clamps to a safe range. */
  targetWordCount?: number;
}

export const startResearch = (data: StartResearchPayload) => {
  const { supplementalFiles, supplementalUrls, ...rest } = data;
  const hasFiles = supplementalFiles && supplementalFiles.length > 0;

  if (hasFiles || (supplementalUrls && supplementalUrls.length > 0)) {
    const form = new FormData();
    form.append('query', rest.query);
    if (rest.supplemental) form.append('supplemental', rest.supplemental);
    if (rest.filterTags?.length) form.append('filterTags', JSON.stringify(rest.filterTags));
    if (rest.modelOverrides && Object.keys(rest.modelOverrides).length > 0) {
      form.append('modelOverrides', JSON.stringify(rest.modelOverrides));
    }
    if (rest.engineVersion) form.append('engineVersion', rest.engineVersion);
    if (rest.researchObjective) form.append('researchObjective', rest.researchObjective);
    if (typeof rest.targetWordCount === 'number') {
      form.append('targetWordCount', String(rest.targetWordCount));
    }
    if (supplementalUrls?.length) {
      form.append('supplementalUrls', JSON.stringify(supplementalUrls));
    }
    for (const f of supplementalFiles ?? []) {
      form.append('files', f);
    }
    return api
      .post<{
        runId: string;
        status: string;
        supplementalIngest?: { urlsQueued: number; filesQueued: number; jobIds: string[] };
      }>('/research', form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      .then((r) => r.data);
  }

  return api
    .post<{
      runId: string;
      status: string;
      supplementalIngest?: { urlsQueued: number; filesQueued: number; jobIds: string[] };
    }>('/research', {
      ...rest,
      supplementalUrls: supplementalUrls?.length ? supplementalUrls : undefined,
    })
    .then((r) => r.data);
};

export const getResearchRuns = (params?: { status?: string }) =>
  api.get<ResearchRun[]>('/research', { params }).then(r => r.data);

export const getResearchRun = (id: string) =>
  api.get<ResearchRun>(`/research/${id}`).then(r => r.data);

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

export const restartRuntime = (adminToken: string) =>
  api.post('/admin/runtime/restart', {}, {
    headers: {
      'x-admin-token': adminToken,
    },
  }).then(r => r.data);

export const ADMIN_SESSION_TOKEN_KEY = 'researchone_admin_token';

export interface RuntimeLogResponse {
  stream: 'out' | 'err';
  lines: number;
  content: string;
  truncated: boolean;
  resolvedPath?: string;
  triedPaths?: string[];
  hint?: string;
}

export const getRuntimeLogs = (
  adminToken: string,
  opts?: { stream?: 'out' | 'err'; lines?: number }
) =>
  api
    .get<RuntimeLogResponse>('/admin/runtime/logs', {
      params: {
        stream: opts?.stream === 'err' ? 'err' : 'out',
        lines: opts?.lines ?? 500,
      },
      headers: {
        'x-admin-token': adminToken,
      },
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

export const getAdminModels = (adminToken: string) =>
  api
    .get<AdminModelsResponse>('/admin/models', {
      headers: { 'x-admin-token': adminToken },
    })
    .then(r => r.data);

export const putAdminModels = (adminToken: string, body: Record<string, unknown>) =>
  api.put('/admin/models', body, {
    headers: { 'x-admin-token': adminToken },
  }).then(r => r.data);

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

export const clearCorpus = (adminToken: string, body: { confirmPhrase: string }) =>
  api
    .post<CorpusClearResponse>('/admin/corpus/clear', body, {
      headers: { 'x-admin-token': adminToken },
    })
    .then(r => r.data);

export interface DeleteCorpusByIngestionJobsResponse {
  ok: boolean;
  deletedSourceIds: string[];
  deletedSourcesCount: number;
  skippedJobIds: string[];
}

export const deleteCorpusByIngestionJobs = (adminToken: string, body: { jobIds: string[] }) =>
  api
    .post<DeleteCorpusByIngestionJobsResponse>('/admin/corpus/delete-by-ingestion-jobs', body, {
      headers: { 'x-admin-token': adminToken },
    })
    .then(r => r.data);

export interface DeleteCorpusByResearchRunResponse {
  ok: boolean;
  runId: string;
  deletedSourceIds: string[];
  deletedSourcesCount: number;
}

export const deleteCorpusByResearchRun = (adminToken: string, body: { runId: string }) =>
  api
    .post<DeleteCorpusByResearchRunResponse>('/admin/corpus/delete-by-research-run', body, {
      headers: { 'x-admin-token': adminToken },
    })
    .then(r => r.data);

export const ingestUrl = (data: { url: string; tags?: string[]; metadata?: Record<string, unknown> }) =>
  api.post<{ jobId: string; status: string }>('/ingestion/url', data).then(r => r.data);

export const ingestText = (data: { text: string; title?: string; tags?: string[] }) =>
  api.post<{ jobId: string; status: string }>('/ingestion/text', data).then(r => r.data);

export const ingestFile = (file: File, tags?: string[]) => {
  const formData = new FormData();
  formData.append('file', file);
  if (tags) formData.append('tags', JSON.stringify(tags));
  return api.post<{ jobId: string; status: string }>('/ingestion/file', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }).then(r => r.data);
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
