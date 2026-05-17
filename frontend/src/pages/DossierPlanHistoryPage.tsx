import { useMemo } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, History } from 'lucide-react';
import { useDossier, usePlanRevisions } from '../hooks/useDossiers';
import { extractApiError } from '../utils/api';

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

function authorLabel(email: string | null, userId: string | null) {
  if (email) return email;
  if (userId) return `User ${userId.slice(0, 8)}…`;
  return 'Unknown';
}

export default function DossierPlanHistoryPage() {
  const { id: dossierId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const dossierQuery = useDossier(dossierId);
  const runId = dossierQuery.data?.runId;
  const revisionsQuery = usePlanRevisions(runId);

  const sortedDesc = useMemo(
    () => [...(revisionsQuery.data?.revisions ?? [])].sort((a, b) => b.revisionNumber - a.revisionNumber),
    [revisionsQuery.data?.revisions],
  );

  if (dossierQuery.isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-4">
        <div className="h-8 w-56 bg-slate-800/60 rounded animate-pulse" />
        <div className="h-32 card animate-pulse" />
      </div>
    );
  }

  if (dossierQuery.isError || !dossierQuery.data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-4">
        <button
          type="button"
          className="text-sm text-accent hover:underline"
          onClick={() => navigate('/app/dossiers')}
        >
          Back to dossiers
        </button>
        <div className="card p-6 text-red-300 text-sm">{extractApiError(dossierQuery.error)}</div>
      </div>
    );
  }

  const dossier = dossierQuery.data;

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
          onClick={() => navigate(`/app/dossiers/${dossierId}`)}
        >
          <ArrowLeft size={16} />
          Back to dossier
        </button>
      </div>

      <header className="space-y-2">
        <div className="inline-flex items-center gap-2 text-accent">
          <History size={20} aria-hidden />
          <span className="text-sm font-medium uppercase tracking-wide">Audit trail</span>
        </div>
        <h1 className="text-xl font-semibold text-white">Plan refinement history</h1>
        <p className="text-sm text-slate-400 line-clamp-2">{dossier.request.query}</p>
        <p className="text-xs text-slate-500">
          Read-only log of each refinement instruction, summary of changes, timestamp, and who made
          the edit. Initial plan generation is not listed here — only post-generation refinements at
          the confirmation gate.
        </p>
      </header>

      {revisionsQuery.isLoading ? (
        <div className="card p-8 text-sm text-slate-400">Loading revision history…</div>
      ) : revisionsQuery.isError ? (
        <div className="card p-6 text-red-300 text-sm">{extractApiError(revisionsQuery.error)}</div>
      ) : sortedDesc.length === 0 ? (
        <div className="card p-8 text-sm text-slate-400" role="status">
          No plan refinements were recorded for this dossier.
        </div>
      ) : (
        <ol className="space-y-4 list-none p-0 m-0" aria-label="Plan revisions, newest first">
          {sortedDesc.map((rev) => (
            <li key={rev.id}>
              <article className="card p-5 space-y-3 border border-slate-800/80">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="text-sm font-medium text-white m-0">
                    Revision {rev.revisionNumber}
                  </h2>
                  <time className="text-xs text-slate-500" dateTime={rev.createdAt}>
                    {formatWhen(rev.createdAt)}
                  </time>
                </div>
                <p className="text-xs text-slate-500">
                  Changed by{' '}
                  <span className="text-slate-300">{authorLabel(rev.createdByEmail, rev.createdBy)}</span>
                </p>
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1 font-medium m-0">
                    Instruction
                  </h3>
                  <p className="text-sm text-slate-200 whitespace-pre-wrap m-0">
                    {rev.refinementPrompt?.trim() || '—'}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs uppercase tracking-wide text-slate-500 mb-1 font-medium m-0">
                    Change summary
                  </h3>
                  <p className="text-sm text-slate-300 whitespace-pre-wrap m-0">
                    {rev.diffSummary?.trim() || '—'}
                  </p>
                </div>
              </article>
            </li>
          ))}
        </ol>
      )}

      <p className="text-xs text-slate-600">
        <Link to={`/app/dossiers/${dossierId}#plan`} className="text-accent hover:underline">
          View current plan on dossier
        </Link>
      </p>
    </div>
  );
}
