import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, FileText, History, LayoutList, NotebookTabs, Sigma } from 'lucide-react';
import clsx from 'clsx';
import { useDossier, useReport } from '../hooks/useDossiers';
import IntentBadge from '../components/dossiers/IntentBadge';
import DossierStatusBadge from '../components/dossiers/DossierStatusBadge';
import DossierReportSection from '../components/dossiers/DossierReportSection';
import DossierStatisticsSection from '../components/dossiers/DossierStatisticsSection';
import ReportForkActions from '../components/reports/ReportForkActions';
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
  const reportId = data?.report?.reportId ?? undefined;
  const reportQuery = useReport(reportId);
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
          {data.plan.orchestrationProfile ? (
            <span className="text-xs rounded-md border border-slate-700 px-2 py-0.5 text-slate-400">
              Profile: {data.plan.orchestrationProfile}
            </span>
          ) : null}
        </div>
        <h1 className="text-xl font-semibold text-white leading-snug">Research dossier</h1>
        <p className="text-sm text-slate-400 line-clamp-3">{data.request.query}</p>
      </header>

      <nav className="flex flex-wrap items-center gap-2 border-b border-slate-800/80 pb-2" aria-label="Dossier sections">
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
        <Link
          to={`/app/dossiers/${id}/plan-history`}
          className="inline-flex items-center gap-2 px-3 py-2 rounded-md text-sm text-slate-400 border border-transparent hover:bg-slate-900/60 ml-auto"
        >
          <History size={16} aria-hidden />
          Plan history
        </Link>
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
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-white font-medium m-0">Plan</h2>
              <Link
                to={`/app/dossiers/${id}/plan-history`}
                className="text-xs text-accent hover:underline inline-flex items-center gap-1"
              >
                <History size={14} aria-hidden />
                Refinement audit trail
              </Link>
            </div>
            {data.plan.planSummary && <p className="text-slate-300">{data.plan.planSummary}</p>}
            <pre className="text-xs bg-slate-950/50 p-3 rounded-md overflow-x-auto text-slate-400">
              {JSON.stringify(data.plan.planPayload, null, 2)}
            </pre>
          </div>
        )}

        {tab === 'report' && (
          <div className="space-y-4">
            <h2 className="text-white font-medium">Report</h2>
            {data.report.reportId ? (
              <>
                <ReportForkActions
                  reportId={data.report.reportId}
                  onEditInPlace={() => navigate(`/app/reports/${data.report.reportId}`)}
                />
                <DossierReportSection
                  plan={data.plan}
                  report={reportQuery.data}
                  reportLoading={reportQuery.isLoading}
                  reportError={reportQuery.error instanceof Error ? reportQuery.error : null}
                  fullReportHref={reportHref!}
                />
              </>
            ) : (
              <p className="text-slate-500">No report is linked to this dossier yet.</p>
            )}
          </div>
        )}

        {tab === 'stats' && <DossierStatisticsSection stats={data.stats} planIntent={data.plan.intent} />}
      </section>
    </div>
  );
}
