import axios from 'axios';

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

export default api;

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
  eventType?: 'progress' | 'run_started' | 'run_failed' | 'run_completed' | 'run_resumed';
  failure?: {
    errorMessage?: string;
    retryable?: boolean;
    failureMeta?: Record<string, unknown>;
  };
}

export interface ResearchRun {
  id: string;
  title: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
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
}) =>
  api
    .post<{ revisionId: string; revisedReportId: string }>(`/reports/${id}/revisions`, data, { timeout: 900000 })
    .then(r => r.data);

export const getReportRevisions = (id: string) =>
  api.get<ReportRevision[]>(`/reports/${id}/revisions`).then(r => r.data);

export const getReportRevision = (id: string, revisionId: string) =>
  api.get<ReportRevisionDetail>(`/reports/${id}/revisions/${revisionId}`).then(r => r.data);

export const publishReportFeatured = (id: string, adminToken: string) =>
  api
    .post<{ ok: boolean; repo: string; path: string; branch: string; commitUrl: string | null }>(
      `/reports/${id}/publish-featured`,
      {},
      { headers: { Authorization: `Bearer ${adminToken}` } }
    )
    .then(r => r.data);

export interface ResearchModelOptionsResponse {
  defaults: Record<string, string>;
  fallbacks: Record<string, string>;
  allowlist: Record<string, string[]>;
}

export const startResearch = (data: {
  query: string;
  supplemental?: string;
  filterTags?: string[];
  modelOverrides?: Record<string, unknown>;
}) =>
  api.post<{ runId: string; status: string }>('/research', data).then(r => r.data);

export const getResearchRuns = (params?: { status?: string }) =>
  api.get<ResearchRun[]>('/research', { params }).then(r => r.data);

export const getResearchRun = (id: string) =>
  api.get<ResearchRun>(`/research/${id}`).then(r => r.data);

export const getResearchModelOptions = () =>
  api.get<ResearchModelOptionsResponse>('/research/model-options').then(r => r.data);

export const cancelResearchRun = (id: string) =>
  api.post<{ ok: boolean; status: string }>(`/research/${id}/cancel`).then(r => r.data);

export const deleteResearchRun = (id: string) =>
  api.delete(`/research/${id}`).then(r => r.data);

export const getSystemHealth = () =>
  api.get<SystemHealth>('/health').then(r => r.data);

export const restartRuntime = (adminToken: string) =>
  api.post('/admin/runtime/restart', {}, {
    headers: {
      Authorization: `Bearer ${adminToken}`,
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
        Authorization: `Bearer ${adminToken}`,
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
      headers: { Authorization: `Bearer ${adminToken}` },
    })
    .then(r => r.data);

export const putAdminModels = (adminToken: string, body: Record<string, unknown>) =>
  api.put('/admin/models', body, {
    headers: { Authorization: `Bearer ${adminToken}` },
  }).then(r => r.data);

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
