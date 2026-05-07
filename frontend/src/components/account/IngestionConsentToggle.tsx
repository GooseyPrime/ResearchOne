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

  const consent = consentQuery.data?.consent ?? true;

  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium text-slate-200">Research Contribution</h3>
          <p className="mt-1 text-xs text-slate-400">
            Allow anonymized, sanitized research artifacts to contribute to the broader research
            knowledge base. Your data is stripped of all personally identifying information before
            any sharing occurs. You can opt out at any time.
          </p>
        </div>
        <button
          onClick={() => toggleMutation.mutate(!consent)}
          disabled={toggleMutation.isPending}
          className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ${
            consent ? 'bg-indigo-600' : 'bg-slate-700'
          } ${toggleMutation.isPending ? 'opacity-50' : ''}`}
          role="switch"
          aria-checked={consent}
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
