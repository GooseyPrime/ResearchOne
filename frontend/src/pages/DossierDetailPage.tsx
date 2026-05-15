import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink, FileText, LayoutList, NotebookTabs, Sigma } from 'lucide-react';
import clsx from 'clsx';
import { useDossier } from '../hooks/useDossiers';
import IntentBadge from '../components/dossiers/IntentBadge';
import DossierStatusBadge from '../components/dossiers/DossierStatusBadge';
import { extractApiError } from '../utils/api';

type TabId = 'request' | 'plan' | 'report' | 'stats';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'request', label: 'Request', icon: NotebookTabs },
  { id: 'plan', label: 'Plan', icon: LayoutList },
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'stats', label: 'Statistics', icon: Sigma },
];

function tabFromHash(): TabId {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  if (h === 'plan' || h === 'report' || h === 'stats' || h === 'request') return h;
  return 'request';
}

export default function DossierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useDossier(id);
  const [tab, setTab] = useState<TabId>(() => tabFromHash());

  useEffect(() => {
    setTab(tabFromHash());
  }, [id]);

  useEffect(() => {
    const onHash = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const setHashTab = useCallback((t: TabId) => {
    setTab(t);
    window.history.replaceState(null, '', `#${t}`);
  }, []);

  const reportHref = useMemo(() => {
    const rid = data?.report?.reportId;
    return rid ? `/app/reports/${rid}` : null;
  }, [data?.report?.reportId]);

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-4">
        <div className="h-8 w-48 bg-slate-800/60 rounded animate-pulse" />
        <div className="h-40 card animate-pulse" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10 space-y-4">
        <button type="button" className="text-sm text-accent hover:underline" onClick={() => navigate('/app/dossiers')}>
          Back to dossiers
        </button>
        <div className="card p-6 text-red-300 text-sm">{extractApiError(error)}</div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto px-6 py-8 space-y-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-white"
          onClick={() => navigate('/app/dossiers')}
        >
          <ArrowLeft size={16} />
          Dossiers
        </button>
      </div>

      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <DossierStatusBadge status={data.runStatus} />
          <IntentBadge intent={data.plan.intent} />
        </div>
        <h1 className="text-xl font-semibold text-white leading-snug">Research dossier</h1>
        <p className="text-sm text-slate-400 line-clamp-3">{data.request.query}</p>
      </header>

      <nav className="flex flex-wrap gap-2 border-b border-slate-800/80 pb-2" aria-label="Dossier sections">
        {TABS.map(({ id: tid, label, icon: Icon }) => (
          <button
            key={tid}
            type="button"
            onClick={() => setHashTab(tid)}
            className={clsx(
              'inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors',
              tab === tid
                ? 'bg-accent/15 text-accent border border-accent/30'
                : 'text-slate-400 border border-transparent hover:bg-slate-900/60',
            )}
          >
            <Icon size={16} />
            {label}
          </button>
        ))}
      </nav>

      <section className="card p-5 space-y-4 text-sm text-slate-200">
        {tab === 'request' && (
          <div className="space-y-2">
            <h2 className="text-white font-medium">Request</h2>
            <p className="whitespace-pre-wrap">{data.request.query}</p>
            {data.request.supplemental && (
              <div>
                <h3 className="text-slate-400 text-xs uppercase tracking-wide mb-1">Supplemental</h3>
                <p className="whitespace-pre-wrap text-slate-300">{data.request.supplemental}</p>
              </div>
            )}
            <p className="text-xs text-slate-500">Created {data.request.createdAt}</p>
          </div>
        )}

        {tab === 'plan' && (
          <div className="space-y-2">
            <h2 className="text-white font-medium">Plan</h2>
            {data.plan.planSummary && <p className="text-slate-300">{data.plan.planSummary}</p>}
            <pre className="text-xs bg-slate-950/50 p-3 rounded-md overflow-x-auto text-slate-400">
              {JSON.stringify(data.plan.planPayload, null, 2)}
            </pre>
          </div>
        )}

        {tab === 'report' && (
          <div className="space-y-3">
            <h2 className="text-white font-medium">Report</h2>
            {data.report.reportId ? (
              <>
                <p className="text-slate-400">
                  Title: <span className="text-slate-200">{data.report.title ?? '—'}</span>
                </p>
                <p className="text-slate-400">
                  Status: <span className="text-slate-200">{data.report.status ?? '—'}</span>
                </p>
                <Link
                  to={reportHref!}
                  className="inline-flex items-center gap-2 text-accent hover:underline text-sm"
                >
                  Open full report
                  <ExternalLink size={14} />
                </Link>
              </>
            ) : (
              <p className="text-slate-500">No report is linked to this dossier yet.</p>
            )}
          </div>
        )}

        {tab === 'stats' && (
          <div className="space-y-2">
            <h2 className="text-white font-medium">Statistics</h2>
            <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
              <Stat label="Duration (ms)" value={data.stats.totalDurationMs} />
              <Stat label="Tokens in" value={data.stats.tokensInput} />
              <Stat label="Tokens out" value={data.stats.tokensOutput} />
              <Stat label="Sources cited" value={data.stats.sourcesCitedCount} />
              <Stat label="Sources retrieved" value={data.stats.sourcesRetrievedCount} />
              <Stat label="Contradictions" value={data.stats.contradictionsCount} />
            </ul>
          </div>
        )}
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <li className="flex justify-between gap-4 border border-slate-800/60 rounded-md px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-100 font-mono text-xs">{value ?? '—'}</span>
    </li>
  );
}
