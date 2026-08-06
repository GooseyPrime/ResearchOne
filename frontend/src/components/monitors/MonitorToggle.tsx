import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Radar, Quote } from 'lucide-react';
import {
  listReportMonitors,
  createMonitorCheckoutSession,
  pauseUserMonitor,
  resumeUserMonitor,
  cancelUserMonitor,
  getMonitorTokenBalance,
  activateLivingReportMonitor,
  toggleLivingReportMonitor,
  setLivingReportAutoRenew,
  MONITOR_TOKENS_QUERY_KEY,
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
    price: '1 token / 2 months per report',
    description:
      'Continuous monitoring of new sources. When Parallel Monitor signals a material change, we run the same revision pipeline as a manual request — full verification workflow, no shortcut prompts.',
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

function formatExpiry(iso: string | null | undefined): string {
  if (!iso) return '';
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

function daysUntil(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}

function LivingReportTokenCard({
  reportId,
  monitor,
}: {
  reportId: string;
  monitor?: ReportMonitorRow;
}) {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const meta = KIND_META.living_report;
  const Icon = meta.icon;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [autoRenewDraft, setAutoRenewDraft] = useState(false);

  const tokenQuery = useQuery({
    queryKey: MONITOR_TOKENS_QUERY_KEY,
    queryFn: getMonitorTokenBalance,
    staleTime: 30_000,
  });

  const balance = tokenQuery.data?.tokenBalance ?? 0;
  const isLegacyStripe = Boolean(monitor?.stripe_subscription_id);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['report-monitors', reportId] });
    void qc.invalidateQueries({ queryKey: MONITOR_TOKENS_QUERY_KEY });
  };

  const activateMut = useMutation({
    mutationFn: (autoRenew: boolean) => activateLivingReportMonitor(reportId, { autoRenew }),
    onSuccess: (data) => {
      invalidate();
      setConfirmOpen(false);
      addNotification(
        'info',
        `Living Report active until ${formatExpiry(data.expiresAt)}. ${data.tokenBalance} token${data.tokenBalance === 1 ? '' : 's'} remaining.`,
      );
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const toggleMut = useMutation({
    mutationFn: (args: { active: boolean; autoRenew?: boolean }) =>
      toggleLivingReportMonitor(monitor!.id, args),
    onSuccess: (data, vars) => {
      invalidate();
      if (vars.active) {
        addNotification(
          'info',
          `Living Report resumed until ${formatExpiry(data.monitor.expires_at)}.`,
        );
      } else {
        addNotification(
          'info',
          'Living Report paused. Turning it on again will consume another token.',
        );
      }
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const autoRenewMut = useMutation({
    mutationFn: (autoRenew: boolean) => setLivingReportAutoRenew(monitor!.id, autoRenew),
    onSuccess: () => {
      invalidate();
      addNotification('info', 'Auto-renew preference saved.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const pauseMut = useMutation({
    mutationFn: () => pauseUserMonitor(monitor!.id),
    onSuccess: () => {
      invalidate();
      addNotification('info', 'Living Report paused.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const resumeMut = useMutation({
    mutationFn: () => resumeUserMonitor(monitor!.id),
    onSuccess: () => {
      invalidate();
      addNotification('info', 'Living Report resumed.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const cancelMut = useMutation({
    mutationFn: () => cancelUserMonitor(monitor!.id),
    onSuccess: () => {
      invalidate();
      addNotification('info', 'Living Report cancelled.');
    },
    onError: (e) => addNotification('error', extractApiError(e)),
  });

  const expiresInDays = daysUntil(monitor?.expires_at);
  const projectedExpiry = useMemo(() => {
    const d = new Date();
    d.setMonth(d.getMonth() + 2);
    return formatExpiry(d.toISOString());
  }, []);

  const showActivate = !monitor || monitor.status === 'cancelled';

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

      {tokenQuery.isSuccess ? (
        <p className="text-xs text-slate-400">
          Account balance:{' '}
          <span className="text-slate-200 font-medium">
            {balance} token{balance === 1 ? '' : 's'}
          </span>
        </p>
      ) : null}

      {monitor && monitor.status === 'active' && monitor.expires_at ? (
        <p className="text-xs text-indigo-300/90">
          Expires {formatExpiry(monitor.expires_at)}
          {expiresInDays != null ? ` (${expiresInDays} day${expiresInDays === 1 ? '' : 's'} left)` : ''}
        </p>
      ) : null}

      {monitor && !isLegacyStripe ? (
        <label className="flex items-start gap-2 text-xs text-slate-400 cursor-pointer">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={Boolean(monitor.auto_renew)}
            disabled={autoRenewMut.isPending || monitor.status !== 'active'}
            onChange={(e) => autoRenewMut.mutate(e.target.checked)}
          />
          <span>Auto-renew using token balance (consumes 1 token every 2 months)</span>
        </label>
      ) : null}

      {monitor ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge border border-slate-600 text-slate-300 capitalize">{monitor.status}</span>
          {isLegacyStripe ? (
            <>
              {monitor.status === 'active' ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => pauseMut.mutate()}
                  disabled={pauseMut.isPending}
                >
                  Pause
                </button>
              ) : monitor.status === 'paused' ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => resumeMut.mutate()}
                  disabled={resumeMut.isPending}
                >
                  Resume
                </button>
              ) : null}
              <button
                type="button"
                className="btn-ghost text-xs text-red-400 hover:text-red-300"
                onClick={() => {
                  if (
                    window.confirm(
                      'Cancel Living Report and end the Stripe subscription for this report?',
                    )
                  ) {
                    cancelMut.mutate();
                  }
                }}
                disabled={cancelMut.isPending}
              >
                Cancel subscription
              </button>
            </>
          ) : (
            <>
              {monitor.status === 'active' ? (
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => {
                    if (
                      window.confirm(
                        'Pause this Living Report? Tokens are not refunded. Turning it on again will consume another token.',
                      )
                    ) {
                      toggleMut.mutate({ active: false });
                    }
                  }}
                  disabled={toggleMut.isPending}
                >
                  Pause
                </button>
              ) : monitor.status === 'paused' ? (
                <button
                  type="button"
                  className="btn text-xs"
                  onClick={() => {
                    setAutoRenewDraft(Boolean(monitor.auto_renew));
                    setConfirmOpen(true);
                  }}
                  disabled={toggleMut.isPending}
                >
                  Resume with token
                </button>
              ) : null}
            </>
          )}
        </div>
      ) : null}

      {showActivate && !isLegacyStripe ? (
        <div className="space-y-2">
          <button
            type="button"
            className="btn text-sm"
            onClick={() => {
              setAutoRenewDraft(false);
              setConfirmOpen(true);
            }}
            disabled={activateMut.isPending}
          >
            {activateMut.isPending ? 'Activating…' : 'Activate with 1 token'}
          </button>
          <p className="text-xs text-slate-500 leading-relaxed">
            Each activation covers 2 months on this report only. Pausing and re-activating uses another
            token.
          </p>
        </div>
      ) : null}

      {confirmOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="living-report-activate-title"
        >
          <div className="w-full max-w-md rounded-lg border border-indigo-900/50 bg-surface-200 p-5 shadow-xl space-y-4">
            <h3 id="living-report-activate-title" className="text-sm font-medium text-slate-100">
              {monitor?.status === 'paused' ? 'Resume Living Report' : 'Activate Living Report'}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              This will consume <strong className="text-slate-200">1 monitor token</strong> and keep this
              report active until approximately <strong className="text-slate-200">{projectedExpiry}</strong>
              {monitor?.status === 'paused'
                ? ' (new token — previous time is not refunded).'
                : '.'}
            </p>
            <p className="text-xs text-slate-500">
              Your balance: {balance} token{balance === 1 ? '' : 's'}
            </p>
            <label className="flex items-start gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={autoRenewDraft}
                onChange={(e) => setAutoRenewDraft(e.target.checked)}
              />
              <span>Auto-renew with token balance when this period ends</span>
            </label>
            <div className="flex flex-wrap gap-2 justify-end">
              <button type="button" className="btn-ghost text-sm" onClick={() => setConfirmOpen(false)}>
                Cancel
              </button>
              {balance < 1 ? (
                <Link to="/app/billing" className="btn text-sm">
                  Buy tokens
                </Link>
              ) : (
                <button
                  type="button"
                  className="btn text-sm"
                  disabled={activateMut.isPending || toggleMut.isPending}
                  onClick={() => {
                    if (monitor?.status === 'paused') {
                      toggleMut.mutate({ active: true, autoRenew: autoRenewDraft });
                      setConfirmOpen(false);
                    } else {
                      activateMut.mutate(autoRenewDraft);
                    }
                  }}
                >
                  Confirm
                </button>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ReverseCitationWatchCard({
  reportId,
  monitor,
}: {
  reportId: string;
  monitor?: ReportMonitorRow;
}) {
  const qc = useQueryClient();
  const { addNotification } = useStore();
  const meta = KIND_META.reverse_citation_watch;
  const Icon = meta.icon;

  const checkoutMut = useMutation({
    mutationFn: () => createMonitorCheckoutSession(reportId, 'reverse_citation_watch'),
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
        <div className="space-y-2">
          <button
            type="button"
            className="btn text-sm"
            onClick={() => checkoutMut.mutate()}
            disabled={checkoutMut.isPending}
          >
            {checkoutMut.isPending ? 'Starting checkout…' : 'Subscribe via Stripe'}
          </button>
          <p className="text-xs text-slate-500 leading-relaxed">
            On Stripe Checkout you can enter a promotion code. If your total is $0 after discounts, you will
            not be asked for a payment method.
          </p>
        </div>
      )}
    </div>
  );
}

function MonitorKindCard({
  kind,
  reportId,
  monitor,
}: {
  kind: MonitorKind;
  reportId: string;
  monitor?: ReportMonitorRow;
}) {
  if (kind === 'living_report') {
    return <LivingReportTokenCard reportId={reportId} monitor={monitor} />;
  }

  return <ReverseCitationWatchCard reportId={reportId} monitor={monitor} />;
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
