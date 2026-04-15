import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ? `${import.meta.env.VITE_API_BASE_URL}/api` : '/api',
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

export interface ResearchRun {
  id: string;
  title: string;
  query: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  error_message?: string;
  started_at?: string;
  completed_at?: string;
  created_at: string;
  plan?: Record<string, unknown>;
  model_log?: unknown[];
}

export interface Report {
  id: string;
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
  metadata?: Record<string, unknown>;
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

export const startResearch = (data: { query: string; supplemental?: string; filterTags?: string[] }) =>
  api.post<{ runId: string; status: string }>('/research', data).then(r => r.data);

export const getResearchRuns = (params?: { status?: string }) =>
  api.get<ResearchRun[]>('/research', { params }).then(r => r.data);

export const getResearchRun = (id: string) =>
  api.get<ResearchRun>(`/research/${id}`).then(r => r.data);

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
  // exportPath may be an absolute filesystem path or just a filename
  const filename = exportPath.split('/').pop() ?? exportPath;
  return base ? `${base}/exports/${filename}` : `/exports/${filename}`;
}
