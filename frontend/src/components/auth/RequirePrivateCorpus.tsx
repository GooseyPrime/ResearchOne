import type { ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { useHasPrivateCorpusAccess } from '../../hooks/useHasPrivateCorpusAccess';

export default function RequirePrivateCorpus({ children }: { children: ReactElement }) {
  const { hasPrivateCorpusAccess, tierGateUnknown, isLoading } = useHasPrivateCorpusAccess();

  if (isLoading || tierGateUnknown) {
    return <div className="p-6 text-sm text-slate-400">Loading subscription…</div>;
  }

  if (!hasPrivateCorpusAccess) {
    return (
      <div className="max-w-lg mx-auto px-6 py-16 space-y-4">
        <h1 className="text-2xl font-bold text-white">Private corpus (Ingest)</h1>
        <p className="text-sm text-slate-400 leading-relaxed">
          The Ingest workspace is for Pro, Team, BYOK, and Sovereign accounts that maintain a{' '}
          <strong className="text-slate-200">separate private corpus</strong> from the shared ResearchOne
          library. You can still attach URLs and files on research requests; those are scoped to your run.
        </p>
        <Link to="/pricing" className="inline-flex text-accent text-sm font-medium hover:underline">
          View plans →
        </Link>
      </div>
    );
  }

  return children;
}
