import { useQuery } from '@tanstack/react-query';
import {
  getDossier,
  getDossiers,
  getReport,
  getRunPlanRevisions,
  type Dossier,
  type DossierListParams,
  type DossierListResult,
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
