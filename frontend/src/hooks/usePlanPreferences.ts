import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getPlanPreferences, patchPlanPreferences, type PlanPreferencesResponse } from '../utils/api';

export const PLAN_PREFERENCES_QUERY_KEY = ['plan-preferences'] as const;

export function usePlanPreferencesQuery(opts?: { enabled?: boolean }) {
  return useQuery({
    queryKey: PLAN_PREFERENCES_QUERY_KEY,
    queryFn: () => getPlanPreferences(),
    enabled: opts?.enabled !== false,
    staleTime: 30_000,
  });
}

export function usePatchPlanPreferencesMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { autoConfirmEnabled?: boolean; autoConfirmThreshold?: number }) => patchPlanPreferences(body),
    onSuccess: (data: PlanPreferencesResponse) => {
      qc.setQueryData(PLAN_PREFERENCES_QUERY_KEY, data);
    },
  });
}
