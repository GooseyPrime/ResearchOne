import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Radar, Quote } from 'lucide-react';
import {
  listReportMonitors,
  createMonitorCheckoutSession,
  pauseUserMonitor,
  resumeUserMonitor,
  cancelUserMonitor,
  extractApiError,
  type ReportMonitorRow,
} from '../../utils/api';
import { useStore } from '../../store/useStore';

type MonitorKind = 'living_report' | 'reverse_citation_watch';

const KIND_META: Record<
  MonitorKind,
  { title: string; price: string; description: string; icon: typeof Radar }
> = {
  living_report: {
    title: 'Living Report',
    price: '$19/mo',
    description:
      'Continuous monitoring of new evidence. When Parallel Monitor signals a material change, we run the same revision pipeline as a manual request — PolicyOne, no shortcut prompts.',
    icon: Radar,
  },
  reverse_citation_watch: {
    title: 'Reverse-Citation Watch',
    price: '$15/mo',
    description:
      'Get notified when this report or its sources are cited or referenced elsewhere. Useful for tracking whether your research is influencing downstream work.',
    icon: Quote,
  },
};

function MonitorKindCard({
  kind,
  reportId,
  monitor,
}: {
  kind: MonitorKind;
  reportId: string;
  monitor?: ReportMonitorRow;
}) {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const meta = KIND_META[kind];
  const Icon = meta.icon;

  const checkoutMut = useMutation({
    mutationFn: () => createMonitorCheckoutSession(reportId, kind),
    onSuccess: (session) => {
      const url = session.checkoutUrl;
      if (url) window.location.href = url;
      else addNotification('error', 'Checkout URL missing — verify Stripe price IDs on the server.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const pauseMut = useMutation({
    mutationFn: () => pauseUserMonitor(monitor!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', `${meta.title} paused.`);
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const resumeMut = useMutation({
    mutationFn: () => resumeUserMonitor(monitor!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', `${meta.title} resumed.`);
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelUserMonitor(monitor!.id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
      addNotification('info', `${meta.title} cancelled.`);
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  return (
    <div className="rounded-lg border border-indigo-900/40 bg-surface-200/80 p-4 space-y-3">
      <div className="flex items-center justify-between gap-2 text-sm font-medium text-slate-200">
        <span className="flex items-center gap-2">
          <Icon size={16} className="text-accent shrink-0" />
          {meta.title}
        </span>
        <span className="text-xs text-slate-500 font-normal">{meta.price}</span>
      </div>
      <p className="text-xs text-slate-500 leading-relaxed">{meta.description}</p>
      {monitor ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge border border-slate-600 text-slate-300 capitalize">{monitor.status}</span>
          {monitor.status === 'active' ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => pauseMut.mutate()} disabled={pauseMut.isPending}>
              Pause
            </button>
          ) : monitor.status === 'paused' ? (
            <button type="button" className="btn-ghost text-xs" onClick={() => resumeMut.mutate()} disabled={resumeMut.isPending}>
              Resume
            </button>
          ) : null}
          <button
            type="button"
            className="btn-ghost text-xs text-red-400 hover:text-red-300"
            onClick={() => {
              if (window.confirm(`Cancel ${meta.title} and end the Stripe subscription for this report?`)) cancelMut.mutate();
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

export default function MonitorToggle({
  reportId,
  reportStatus,
}: {
  reportId: string;
  reportStatus: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['report-monitors', reportId],
    queryFn: () => listReportMonitors(reportId),
    enabled: reportStatus === 'finalized',
  });

  if (reportStatus !== 'finalized') return null;

  const monitors = data?.monitors ?? [];
  const living = monitors.find((m) => m.monitor_kind === 'living_report');
  const rcw = monitors.find((m) => m.monitor_kind === 'reverse_citation_watch');

  return (
    <div className="space-y-3">
      <p className="text-xs text-slate-500">
        Add-ons require an active Pro, BYOK, Team, or Sovereign subscription.
      </p>
      {isLoading ? (
        <p className="text-xs text-slate-500">Loading monitor status…</p>
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          <MonitorKindCard kind="living_report" reportId={reportId} monitor={living} />
          <MonitorKindCard kind="reverse_citation_watch" reportId={reportId} monitor={rcw} />
        </div>
      )}
    </div>
  );
}
