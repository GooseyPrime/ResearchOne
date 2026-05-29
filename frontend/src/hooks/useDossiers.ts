import { useQuery } from '@tanstack/react-query';
import {
  getDossier,
  getDossiers,
  getReport,
  getRunPlanRevisions,
  getDossierReportHistory,
  getDossierSpinoffs,
  getDossierSources,
  fetchDossierTimeline,
  type Dossier,
  type DossierListParams,
  type DossierListResult,
  type DossierReportHistoryEntry,
  type DossierSpinoffEntry,
  type DossierSourceEntry,
  type DossierTimelineResult,
  type PlanRevisionRow,
  type Report,
} from '../utils/api';

export type RunPlanRevisionsPayload = { runId: string; revisions: PlanRevisionRow[] };

export function useDossiers(params: DossierListParams = {}) {
  return useQuery<DossierListResult>({
    queryKey: ['dossiers', params],
    queryFn: () => getDossiers(params),
    refetchInterval: 15_000,
  });
}

export function useDossier(dossierId: string | undefined) {
  return useQuery<Dossier>({
    queryKey: ['dossier', dossierId],
    queryFn: () => getDossier(dossierId!),
    enabled: Boolean(dossierId),
  });
}

export function useReport(reportId: string | undefined) {
  return useQuery<Report>({
    queryKey: ['report', reportId],
    queryFn: () => getReport(reportId!),
    enabled: Boolean(reportId),
  });
}

/** Wave 5.4 — plan refinement revisions for a run (dossier ACL enforced server-side). */
export function usePlanRevisions(runId: string | undefined) {
  return useQuery<RunPlanRevisionsPayload>({
    queryKey: ['plan-revisions', runId],
    queryFn: () => getRunPlanRevisions(runId!),
    enabled: Boolean(runId),
  });
}

export function useDossierReportHistory(dossierId: string | undefined) {
  return useQuery<{ entries: DossierReportHistoryEntry[] }>({
    queryKey: ['dossier-report-history', dossierId],
    queryFn: () => getDossierReportHistory(dossierId!),
    enabled: Boolean(dossierId),
    retry: false,
  });
}

export function useDossierSpinoffs(dossierId: string | undefined) {
  return useQuery<{ spinoffs: DossierSpinoffEntry[] }>({
    queryKey: ['dossier-spinoffs', dossierId],
    queryFn: () => getDossierSpinoffs(dossierId!),
    enabled: Boolean(dossierId),
    retry: false,
  });
}

export function useDossierSources(dossierId: string | undefined) {
  return useQuery<{ sources: DossierSourceEntry[] }>({
    queryKey: ['dossier-sources', dossierId],
    queryFn: () => getDossierSources(dossierId!),
    enabled: Boolean(dossierId),
    retry: false,
  });
}

export function useDossierTimeline(params: {
  page?: number;
  pageSize?: number;
  enabled?: boolean;
}) {
  const { enabled = true, ...rest } = params;
  return useQuery<DossierTimelineResult>({
    queryKey: ['dossier-timeline', rest],
    queryFn: () => fetchDossierTimeline(rest),
    enabled,
    retry: false,
  });
}
