import { useMemo } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  createMonitorCheckoutSession,
  extractApiError,
  getReports,
  listUserMonitors,
  type Report,
  type ReportMonitorKind,
} from '../../utils/api';
import { useStore } from '../../store/useStore';

function reportIdsWithActiveMonitor(
  monitors: { report_id: string; monitor_kind: ReportMonitorKind; status: string }[],
  monitorKind: ReportMonitorKind,
): Set<string> {
  const ids = new Set<string>();
  for (const m of monitors) {
    if (m.monitor_kind === monitorKind && m.status !== 'cancelled') {
      ids.add(m.report_id);
    }
  }
  return ids;
}

export default function ReportSubscribeModal({
  monitorKind,
  addonName,
  onClose,
}: {
  monitorKind: ReportMonitorKind;
  addonName: string;
  onClose: () => void;
}) {
  const { addNotification } = useStore();

  const reportsQuery = useQuery({
    queryKey: ['reports', 'finalized', 'addon-pick'],
    queryFn: () => getReports({ status: 'finalized' }),
  });

  const monitorsQuery = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: listUserMonitors,
  });

  const subscribedReportIds = useMemo(
    () => reportIdsWithActiveMonitor(monitorsQuery.data?.monitors ?? [], monitorKind),
    [monitorsQuery.data?.monitors, monitorKind],
  );

  const checkoutMut = useMutation({
    mutationFn: (reportId: string) => createMonitorCheckoutSession(reportId, monitorKind),
    onSuccess: (session) => {
      const url = session.checkoutUrl;
      if (url) window.location.href = url;
      else addNotification('error', 'Checkout URL missing — verify Stripe price IDs on the server.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const reports = reportsQuery.data ?? [];
  const availableReports = reports.filter((r) => !subscribedReportIds.has(r.id));

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="report-subscribe-title"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="report-subscribe-title" className="text-lg font-medium text-slate-100">
            Subscribe to {addonName}
          </h2>
          <button type="button" className="btn-ghost text-xs shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Choose a finalized report. Each report gets its own Stripe subscription for this add-on.
        </p>

        {reportsQuery.isLoading || monitorsQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading reports…</p>
        ) : reportsQuery.isError ? (
          <p className="mt-4 text-sm text-red-400">{extractApiError(reportsQuery.error)}</p>
        ) : monitorsQuery.isError ? (
          <div className="mt-4 space-y-2">
            <p className="text-sm text-red-400">{extractApiError(monitorsQuery.error)}</p>
            <button
              type="button"
              className="btn-ghost text-xs"
              onClick={() => monitorsQuery.refetch()}
              disabled={monitorsQuery.isFetching}
            >
              {monitorsQuery.isFetching ? 'Retrying…' : 'Retry'}
            </button>
          </div>
        ) : reports.length === 0 ? (
          <div className="mt-4 rounded-md border border-white/10 bg-slate-800/50 p-4 text-sm text-slate-400">
            <p>No finalized reports yet. Complete a research run and finalize a report first.</p>
            <Link to="/app/research" className="mt-2 inline-block text-indigo-400 hover:text-indigo-300">
              Start research →
            </Link>
          </div>
        ) : availableReports.length === 0 ? (
          <div className="mt-4 rounded-md border border-white/10 bg-slate-800/50 p-4 text-sm text-slate-400">
            <p>Every finalized report already has this add-on. Manage existing subscriptions from Billing.</p>
            <Link to="/app/billing" className="mt-2 inline-block text-indigo-400 hover:text-indigo-300">
              Account &amp; billing →
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {reports.map((report: Report) => {
              const alreadySubscribed = subscribedReportIds.has(report.id);
              return (
                <li
                  key={report.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-800/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{report.title || report.query}</p>
                    <p className="text-xs text-slate-500">{report.id.slice(0, 8)}…</p>
                  </div>
                  {alreadySubscribed ? (
                    <span className="text-xs text-emerald-400 shrink-0">Already subscribed</span>
                  ) : (
                    <button
                      type="button"
                      className="btn text-xs shrink-0"
                      disabled={checkoutMut.isPending}
                      onClick={() => checkoutMut.mutate(report.id)}
                    >
                      {checkoutMut.isPending ? 'Starting…' : 'Checkout'}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
