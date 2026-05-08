import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radar } from 'lucide-react';
import {
  listReportMonitors,
  createMonitorCheckoutSession,
  pauseUserMonitor,
  resumeUserMonitor,
  cancelUserMonitor,
  extractApiError,
} from '../../utils/api';
import { useStore } from '../../store/useStore';

export default function MonitorToggle({
  reportId,
  reportStatus,
}: {
  reportId: string;
  reportStatus: string;
}) {
  const qc = useQueryClient();
  const { addNotification } = useStore();

  const { data, isLoading } = useQuery({
    queryKey: ['report-monitors', reportId],
    queryFn: () => listReportMonitors(reportId),
    enabled: reportStatus === 'finalized',
  });

  const monitors = data?.monitors ?? [];
  const living = monitors.find((m) => m.monitor_kind === 'living_report');

  const checkoutMut = useMutation({
    mutationFn: () => createMonitorCheckoutSession(reportId, 'living_report'),
    onSuccess: (session) => {
      const url = session.checkoutUrl;
      if (url) window.location.href = url;
      else addNotification('error', 'Checkout URL missing — verify Stripe price IDs on the server.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const pauseMut = useMutation({
    mutationFn: () => pauseUserMonitor(living!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', 'Living Report monitor paused.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const resumeMut = useMutation({
    mutationFn: () => resumeUserMonitor(living!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', 'Living Report monitor resumed.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelUserMonitor(living!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', 'Living Report monitor cancelled.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  if (reportStatus !== 'finalized') return null;

  return (
    <div className="rounded-lg border border-indigo-900/40 bg-surface-200/80 p-4 space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium text-slate-200">
        <Radar size={16} className="text-accent shrink-0" />
        Living Report monitor
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">
        Subscribe to keep this finalized report aligned with new evidence. When Parallel Monitor signals a material change,
        we run the same revision pipeline as a manual request (PolicyOne — no shortcut prompts).
      </p>
      {isLoading ? (
        <p className="text-xs text-slate-500">Loading monitor status…</p>
      ) : living ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge border border-slate-600 text-slate-300 capitalize">{living.status}</span>
          {living.status === 'active' ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}>
              Pause
            </button>
          ) : living.status === 'paused' ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}>
              Resume
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost text-xs text-red-400 hover:text-red-300"
            onClick={() => {
              if (window.confirm('Cancel this monitor and end the Stripe subscription for this report?')) cancelMut.mutate();
            }}
            disabled={cancelMut.isPending}
          >
            Cancel subscription
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="btn text-sm"
          onClick={() => checkoutMut.mutate()}
          disabled={checkoutMut.isPending}
        >
          {checkoutMut.isPending ? 'Starting checkout…' : 'Subscribe via Stripe'}
        </button>
      )}
    </div>
  );
}
