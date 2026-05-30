import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  FileText,
  History,
  LayoutList,
  NotebookTabs,
  Sigma,
  GitBranch,
  Database,
} from 'lucide-react';
import clsx from 'clsx';
import { format } from 'date-fns';
import {
  useDossier,
  useReport,
  useDossierReportHistory,
  useDossierSpinoffs,
} from '../hooks/useDossiers';
import IntentBadge from '../components/dossiers/IntentBadge';
import DossierStatusBadge from '../components/dossiers/DossierStatusBadge';
import DossierReportSection from '../components/dossiers/DossierReportSection';
import DossierStatisticsSection from '../components/dossiers/DossierStatisticsSection';
import ReportForkActions from '../components/reports/ReportForkActions';
import { extractApiError } from '../utils/api';

type TabId = 'request' | 'plan' | 'report' | 'report-history' | 'spinoffs' | 'stats';

const TABS: { id: TabId; label: string; icon: typeof FileText }[] = [
  { id: 'request', label: 'Request', icon: NotebookTabs },
  { id: 'plan', label: 'Plan', icon: LayoutList },
  { id: 'report', label: 'Report', icon: FileText },
  { id: 'report-history', label: 'Report history', icon: History },
  { id: 'spinoffs', label: 'Spinoffs', icon: GitBranch },
  { id: 'stats', label: 'Statistics', icon: Sigma },
];

function tabFromHash(): TabId {
  const h = (typeof window !== 'undefined' ? window.location.hash : '').replace(/^#/, '');
  if (
    h === 'plan' ||
    h === 'report' ||
    h === 'stats' ||
    h === 'request' ||
    h === 'report-history' ||
    h === 'spinoffs' ||
    h === 'sources'
  ) {
    return h;
  }
  return 'request';
}

export default function DossierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, isError, error } = useDossier(id);
  const reportId = data?.report?.reportId ?? undefined;
  const reportQuery = useReport(reportId);
  const historyQuery = useDossierReportHistory(id);
  const spinoffsQuery = useDossierSpinoffs(id);
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

        {tab === 'report-history' && (
          <div className="space-y-3">
            <h2 className="text-white font-medium">Report history</h2>
            <p className="text-xs text-slate-500">Revision chain for reports linked to this dossier.</p>
            {historyQuery.isLoading ? (
              <p className="text-slate-500">Loading report history…</p>
            ) : historyQuery.isError ? (
              <p className="text-slate-500">{extractApiError(historyQuery.error)}</p>
            ) : (historyQuery.data?.entries ?? []).length === 0 ? (
              <p className="text-slate-500">No revision history recorded yet.</p>
            ) : (
              <ol className="space-y-2">
                {(historyQuery.data?.entries ?? []).map((entry) => (
                  <li
                    key={entry.reportId}
                    className="rounded-lg border border-slate-800/80 bg-slate-950/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div>
                      <Link to={`/app/reports/${entry.reportId}`} className="text-accent hover:underline font-medium">
                        v{entry.versionNumber} — {entry.title}
                      </Link>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {entry.status}
                        {entry.revisionNumber != null ? ` · revision #${entry.revisionNumber}` : ''}
                        {entry.createdAt ? ` · ${format(new Date(entry.createdAt), 'MMM d, yyyy')}` : ''}
                      </p>
                    </div>
                    {entry.parentReportId ? (
                      <Link
                        to={`/app/reports/${entry.parentReportId}`}
                        className="text-xs text-slate-400 hover:text-accent"
                      >
                        Parent report
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </div>
        )}

        {tab === 'spinoffs' && (
          <div className="space-y-3">
            <h2 className="text-white font-medium">Spinoffs</h2>
            <p className="text-xs text-slate-500">Child research runs forked from this dossier&apos;s report lineage.</p>
            {spinoffsQuery.isLoading ? (
              <p className="text-slate-500">Loading spinoffs…</p>
            ) : spinoffsQuery.isError ? (
              <p className="text-slate-500">{extractApiError(spinoffsQuery.error)}</p>
            ) : (spinoffsQuery.data?.spinoffs ?? []).length === 0 ? (
              <p className="text-slate-500">No spinoff runs yet.</p>
            ) : (
              <ul className="space-y-2">
                {(spinoffsQuery.data?.spinoffs ?? []).map((s) => (
                  <li
                    key={s.runId}
                    className="rounded-lg border border-slate-800/80 bg-slate-950/30 px-3 py-2 flex flex-wrap items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <p className="text-slate-200 line-clamp-2">{s.query}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {s.runStatus}
                        {s.engineVersion ? ` · ${s.engineVersion}` : ''}
                        {s.createdAt ? ` · ${format(new Date(s.createdAt), 'MMM d, yyyy')}` : ''}
                      </p>
                    </div>
                    <div className="flex gap-2 text-xs shrink-0">
                      <Link to={`/app/dossiers/${s.dossierId}`} className="text-accent hover:underline">
                        Dossier
                      </Link>
                      <Link to={`/app/run/${s.runId}`} className="text-accent hover:underline">
                        Run
                      </Link>
                      {s.reportId ? (
                        <Link to={`/app/reports/${s.reportId}`} className="text-accent hover:underline">
                          Report
                        </Link>
                      ) : null}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}


        {tab === 'stats' && <DossierStatisticsSection stats={data.stats} planIntent={data.plan.intent} />}
      </section>
    </div>
  );
}
