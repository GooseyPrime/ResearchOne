import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import api, { extractApiError } from '../../utils/api';
import { useState } from 'react';

export default function IngestionConsentToggle() {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const consentQuery = useQuery({
    queryKey: ['ingestion-consent'],
    queryFn: async () => (await api.get<{ consent: boolean }>('/ingestion/consent')).data,
  });

  const toggleMutation = useMutation({
    mutationFn: async (consent: boolean) => {
      await api.post('/ingestion/consent', { pipeline_b_consent: consent });
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['ingestion-consent'] });
      setError(null);
    },
    onError: (err: unknown) => setError(extractApiError(err)),
  });

  const isLoading = consentQuery.isLoading;
  const consent = consentQuery.data?.consent ?? false;

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200">ResearchOne shared corpus</h3>
          <p className="mt-1 text-xs text-slate-400">
            When enabled, eligible sanitized excerpts from your research may be added to the shared
            ResearchOne corpus (Pipeline B). Turning this off stops new contributions; material already
            added cannot be removed. This is separate from your private Ingest workspace on paid plans.
          </p>
        </div>
        <button
          type="button"
          onClick={() => toggleMutation.mutate(!consent)}
          disabled={toggleMutation.isPending || isLoading}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            consent ? 'bg-indigo-600' : 'bg-slate-700'
          } ${toggleMutation.isPending || isLoading ? 'opacity-50' : ''}`}
          role="switch"
          aria-checked={consent}
          aria-label="Toggle research contribution"
        >
          <span
            className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow transition duration-200 ${
              consent ? 'translate-x-5' : 'translate-x-0'
            }`}
          />
        </button>
      </div>
      {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
    </div>
  );
}
