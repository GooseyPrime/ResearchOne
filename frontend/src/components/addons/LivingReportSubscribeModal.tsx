import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { isAxiosError } from 'axios';
import {
  activateLivingReportMonitor,
  extractApiError,
  getMonitorTokenBalance,
  getReports,
  listUserMonitors,
  MONITOR_TOKENS_QUERY_KEY,
  type Report,
} from '../../utils/api';
import { useStore } from '../../store/useStore';

function reportIdsWithLivingMonitor(
  monitors: { report_id: string; monitor_kind: string; status: string }[],
): Set<string> {
  const ids = new Set<string>();
  for (const m of monitors) {
    if (m.monitor_kind === 'living_report' && m.status !== 'cancelled') {
      ids.add(m.report_id);
    }
  }
  return ids;
}

function formatExpiry(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

export default function LivingReportSubscribeModal({
  addonName,
  onClose,
}: {
  addonName: string;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const [confirmReportId, setConfirmReportId] = useState<string | null>(null);
  const [autoRenew, setAutoRenew] = useState(false);

  const reportsQuery = useQuery({
    queryKey: ['reports', 'finalized', 'living-report-pick'],
    queryFn: () => getReports({ status: 'finalized' }),
  });

  const monitorsQuery = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: listUserMonitors,
  });

  const tokenQuery = useQuery({
    queryKey: MONITOR_TOKENS_QUERY_KEY,
    queryFn: getMonitorTokenBalance,
  });

  const activeReportIds = useMemo(
    () => reportIdsWithLivingMonitor(monitorsQuery.data?.monitors ?? []),
    [monitorsQuery.data?.monitors],
  );

  const balance = tokenQuery.data?.tokenBalance ?? 0;

  const activateMut = useMutation({
    mutationFn: ({ reportId, autoRenew: renew }: { reportId: string; autoRenew: boolean }) =>
      activateLivingReportMonitor(reportId, { autoRenew: renew }),
    onSuccess: (data) => {
      void qc.invalidateQueries({ queryKey: ['billing-monitors'] });
      void qc.invalidateQueries({ queryKey: MONITOR_TOKENS_QUERY_KEY });
      setConfirmReportId(null);
      addNotification(
        'info',
        `Living Report active until ${formatExpiry(data.expiresAt)}. ${data.tokenBalance} token${data.tokenBalance === 1 ? '' : 's'} remaining.`,
      );
      onClose();
    },
    onError: (e) => {
      const needsTokens =
        isAxiosError(e) && (e.response?.status === 402 || e.response?.data?.error?.includes?.('token'));
      if (needsTokens) {
        addNotification('error', `${extractApiError(e)} Buy monitor tokens in Account.`);
      } else {
        addNotification('error', extractApiError(e));
      }
    },
  });

  const reports = reportsQuery.data ?? [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="living-report-subscribe-title"
    >
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg border border-white/10 bg-slate-900 p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <h2 id="living-report-subscribe-title" className="text-lg font-medium text-slate-100">
            Activate {addonName}
          </h2>
          <button type="button" className="btn-ghost text-xs shrink-0" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Choose a finalized report. Each activation uses <strong className="text-slate-200">1 monitor token</strong>{' '}
          for two months of Living Report monitoring on that report.
        </p>
        {tokenQuery.isSuccess ? (
          <p className="mt-2 text-xs text-slate-400">
            Balance:{' '}
            <span className="text-slate-200 font-medium">
              {balance} token{balance === 1 ? '' : 's'}
            </span>
            {balance < 1 ? (
              <>
                {' '}
                —{' '}
                <Link to="/app/billing#monitor-tokens" className="text-indigo-400 hover:text-indigo-300">
                  Buy tokens
                </Link>
              </>
            ) : null}
          </p>
        ) : null}

        {reportsQuery.isLoading || monitorsQuery.isLoading ? (
          <p className="mt-4 text-sm text-slate-500">Loading reports…</p>
        ) : reportsQuery.isError ? (
          <p className="mt-4 text-sm text-red-400">{extractApiError(reportsQuery.error)}</p>
        ) : reports.length === 0 ? (
          <div className="mt-4 rounded-md border border-white/10 bg-slate-800/50 p-4 text-sm text-slate-400">
            <p>No finalized reports yet. Complete a research run and finalize a report first.</p>
            <Link to="/app/research" className="mt-2 inline-block text-indigo-400 hover:text-indigo-300">
              Start research →
            </Link>
          </div>
        ) : (
          <ul className="mt-4 space-y-2">
            {reports.map((report: Report) => {
              const alreadyActive = activeReportIds.has(report.id);
              return (
                <li
                  key={report.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-white/10 bg-slate-800/40 px-3 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{report.title || report.query}</p>
                    <p className="text-xs text-slate-500">{report.id.slice(0, 8)}…</p>
                  </div>
                  {alreadyActive ? (
                    <span className="text-xs text-emerald-400 shrink-0">Already active</span>
                  ) : (
                    <button
                      type="button"
                      className="btn text-xs shrink-0"
                      disabled={activateMut.isPending}
                      onClick={() => {
                        setAutoRenew(false);
                        setConfirmReportId(report.id);
                      }}
                    >
                      Activate
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirmReportId ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="living-report-confirm-title"
        >
          <div className="w-full max-w-md rounded-lg border border-indigo-900/50 bg-slate-900 p-5 shadow-xl space-y-4">
            <h3 id="living-report-confirm-title" className="text-sm font-medium text-slate-100">
              Confirm activation
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This consumes 1 monitor token for two months on the selected report.
            </p>
            <label className="flex items-start gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoRenew}
                onChange={(e) => setAutoRenew(e.target.checked)}
              />
              <span>Auto-renew with token balance when this period ends</span>
            </label>
            <div className="flex flex-wrap gap-2 justify-end">
              <button
                type="button"
                className="btn-ghost text-sm"
                onClick={() => setConfirmReportId(null)}
              >
                Cancel
              </button>
              {balance < 1 ? (
                <Link to="/app/billing#monitor-tokens" className="btn text-sm">
                  Buy tokens
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn text-sm"
                  disabled={activateMut.isPending}
                  onClick={() =>
                    activateMut.mutate({ reportId: confirmReportId, autoRenew })
                  }
                >
                  {activateMut.isPending ? 'Activating…' : 'Use 1 token'}
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
