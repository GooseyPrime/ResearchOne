import { useQuery } from '@tanstack/react-query';
import { getDossier, getDossiers, type Dossier, type DossierListParams, type DossierListResult } from '../utils/api';

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
