import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Trash2 } from 'lucide-react';
import {
  deleteSavedOrchestrationProfile,
  extractApiError,
  listSavedOrchestrationProfiles,
  type SavedOrchestrationProfile,
} from '../../utils/api';

export const SAVED_ORCHESTRATION_PROFILES_QUERY_KEY = ['saved-orchestration-profiles'] as const;

export default function SavedOrchestrationProfilesCard({ tierAllowsProfiles }: { tierAllowsProfiles: boolean }) {
  const qc = useQueryClient();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: SAVED_ORCHESTRATION_PROFILES_QUERY_KEY,
    queryFn: () => listSavedOrchestrationProfiles().then((r) => r.profiles),
    enabled: tierAllowsProfiles,
  });

  const del = useMutation({
    mutationFn: (id: string) => deleteSavedOrchestrationProfile(id),
    onMutate: () => setDeleteError(null),
    onSuccess: () => void qc.invalidateQueries({ queryKey: SAVED_ORCHESTRATION_PROFILES_QUERY_KEY }),
    onError: (err) => setDeleteError(extractApiError(err)),
  });

  if (!tierAllowsProfiles) {
    return (
      <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-left space-y-2 max-w-xl w-full">
        <h2 className="text-sm font-semibold text-white">Saved orchestration profiles</h2>
        <p className="text-xs text-slate-400 leading-snug">
          Saved profiles are available on paid tiers (Pro, Team, BYOK, Sovereign). They let you reuse orchestration
          defaults on new runs. Upgrade on the{' '}
          <Link to="/pricing" className="text-accent hover:underline">
            pricing page
          </Link>{' '}
          to use this feature.
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-950/40 p-5 text-left space-y-3 max-w-xl w-full">
      <h2 className="text-sm font-semibold text-white">Saved orchestration profiles</h2>
      <p className="text-xs text-slate-400 leading-snug">
        Save a plan from the confirmation panel on{' '}
        <Link to="/app/research-v2" className="text-accent hover:underline">
          Deep Research
        </Link>
        . Select a profile before starting a run to seed the planner.
      </p>

      {q.isLoading && <p className="text-xs text-slate-500">Loading profiles…</p>}
      {q.isError && <p className="text-xs text-red-300">{extractApiError(q.error)}</p>}
      {deleteError ? <p className="text-xs text-red-300">{deleteError}</p> : null}

      {q.data && q.data.length === 0 && <p className="text-xs text-slate-500">No saved profiles yet.</p>}

      {q.data && q.data.length > 0 && (
        <ul className="space-y-2">
          {q.data.map((p: SavedOrchestrationProfile) => (
            <li
              key={p.id}
              className="flex items-start justify-between gap-2 rounded-lg border border-slate-800/80 bg-slate-900/30 px-3 py-2 text-xs"
            >
              <div className="min-w-0">
                <p className="text-slate-100 font-medium truncate">{p.name}</p>
                <p className="text-slate-500 font-mono truncate">{p.baseIntent}</p>
                {p.isShared ? <span className="text-[10px] uppercase text-amber-400/90">Shared</span> : null}
              </div>
              <button
                type="button"
                className="btn-ghost text-red-400 hover:text-red-300 p-1 flex-shrink-0"
                aria-label={`Delete profile ${p.name}`}
                disabled={del.isPending}
                onClick={() => del.mutate(p.id)}
              >
                <Trash2 size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
