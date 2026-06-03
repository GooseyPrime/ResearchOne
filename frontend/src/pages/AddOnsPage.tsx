import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Lock, Radar, Quote, FlaskConical, Layers } from 'lucide-react';
import api, {
  extractApiError,
  listUserMonitors,
  type ReportMonitorKind,
  type ReportMonitorRow,
} from '../utils/api';
import { useHasProAccess } from '../hooks/useHasProAccess';
import ReportSubscribeModal from '../components/addons/ReportSubscribeModal';
import LivingReportSubscribeModal from '../components/addons/LivingReportSubscribeModal';
import { RESEARCH_ADDONS_QUERY_KEY } from '../utils/researchRunAddons';

export type AddonCatalogEntry = {
  id: string;
  name: string;
  description: string;
  priceLabel: string;
  billingModel: 'report_subscription' | 'token_pack' | 'per_run' | 'enterprise_inquiry';
  category: 'report_monitor' | 'research_run' | 'platform';
  monitorKind?: ReportMonitorKind;
  runAddonKey?: string;
  managePath?: string;
  comingSoon: boolean;
  stripeConfigured: boolean;
  enterpriseMailto?: string;
};

const ICON_BY_ID: Record<string, typeof Radar> = {
  living_report: Radar,
  reverse_citation_watch: Quote,
};

function activeMonitorsForKind(monitors: ReportMonitorRow[], kind: ReportMonitorKind) {
  return monitors.filter(
    (m) => m.monitor_kind === kind && (m.status === 'active' || m.status === 'paused'),
  );
}

function monitorStatusLabel(m: ReportMonitorRow): string {
  if (m.monitor_kind === 'living_report' && m.expires_at) {
    try {
      const exp = new Date(m.expires_at).toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });
      return `${m.status} · until ${exp}`;
    } catch {
      return m.status;
    }
  }
  return m.status;
}

export default function AddOnsPage() {
  const { hasProAccess } = useHasProAccess();
  const [subscribeKind, setSubscribeKind] = useState<{
    kind: ReportMonitorKind;
    name: string;
    billingModel: AddonCatalogEntry['billingModel'];
  } | null>(null);

  const catalogQuery = useQuery({
    queryKey: ['billing-addon-catalog'],
    queryFn: async () => (await api.get<{ addons: AddonCatalogEntry[] }>('/billing/addon-catalog')).data,
  });

  const monitorsQuery = useQuery({
    queryKey: ['billing-monitors'],
    queryFn: listUserMonitors,
    enabled: hasProAccess,
  });

  const monitors =
    monitorsQuery.isError || monitorsQuery.isLoading ? [] : (monitorsQuery.data?.monitors ?? []);
  const addons = catalogQuery.data?.addons ?? [];

  const reportAddons = useMemo(() => addons.filter((a) => a.category === 'report_monitor'), [addons]);
  const runAddons = useMemo(() => addons.filter((a) => a.category === 'research_run'), [addons]);
  const platformAddons = useMemo(() => addons.filter((a) => a.category === 'platform'), [addons]);

  return (
    <div className="mx-auto max-w-5xl px-6 py-8 space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">Add-ons</h1>
        <p className="mt-2 text-sm text-slate-400 max-w-2xl">
          Extend your subscription with per-report monitors, per-run enhancements, and platform capabilities.
          Reverse-Citation Watch bills through Stripe per report. Living Reports use monitor tokens from Account.
          Run enhancements apply as wallet surcharges when you enable them on a research job.
        </p>
        {!hasProAccess && !catalogQuery.isLoading ? (
          <div className="mt-4 rounded-md border border-amber-700/30 bg-amber-950/20 px-4 py-3 text-sm text-amber-200 flex gap-2">
            <Lock size={18} className="shrink-0 mt-0.5" />
            <p>
              Add-ons require an active Pro, BYOK, Team, or Sovereign plan.{' '}
              <Link to="/app/billing" className="text-indigo-300 hover:underline">
                Upgrade in Account
              </Link>{' '}
              or{' '}
              <Link to="/pricing" className="text-indigo-300 hover:underline">
                compare plans
              </Link>
              .
            </p>
          </div>
        ) : null}
      </div>

      {catalogQuery.isError ? (
        <p className="text-sm text-red-400">Could not load add-on catalog.</p>
      ) : null}

      {hasProAccess && monitorsQuery.isError ? (
        <p className="text-sm text-red-400">
          Could not load your monitor subscriptions. {extractApiError(monitorsQuery.error)}
        </p>
      ) : null}

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-200">Report monitors</h2>
        <p className="text-xs text-slate-500">
          Per finalized report · Living Reports = monitor tokens · Reverse-Citation Watch = Stripe per report
        </p>
        <div className="grid gap-4 md:grid-cols-2">
          {reportAddons.map((addon) => {
            const Icon = ICON_BY_ID[addon.id] ?? Radar;
            const active =
              addon.monitorKind != null ? activeMonitorsForKind(monitors, addon.monitorKind) : [];
            return (
              <article key={addon.id} className="card-glow p-5 flex flex-col">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex items-center gap-2 text-slate-200 font-medium">
                    <Icon size={18} className="text-accent shrink-0" />
                    {addon.name}
                  </span>
                  <span className="text-xs text-slate-500 shrink-0">{addon.priceLabel}</span>
                </div>
                <p className="mt-3 text-sm text-slate-400 leading-relaxed flex-1">{addon.description}</p>
                {active.length > 0 ? (
                  <div className="mt-3 text-xs text-emerald-400/90">
                    <p>
                      {active.length}{' '}
                      {addon.billingModel === 'token_pack' || addon.monitorKind === 'living_report'
                        ? `active monitor${active.length === 1 ? '' : 's'}`
                        : `active subscription${active.length === 1 ? '' : 's'}`}
                    </p>
                    <ul className="mt-1 space-y-0.5 text-slate-500">
                      {active.slice(0, 3).map((m) => (
                        <li key={m.id}>{monitorStatusLabel(m)}</li>
                      ))}
                      {active.length > 3 ? <li>+{active.length - 3} more</li> : null}
                    </ul>
                  </div>
                ) : null}
                <div className="mt-4 flex flex-wrap gap-2">
                  {addon.managePath ? (
                    <Link to={addon.managePath} className="btn-ghost text-xs">
                      Manage
                    </Link>
                  ) : null}
                  {addon.comingSoon ? null : hasProAccess && addon.monitorKind ? (
                    addon.billingModel === 'token_pack' ? (
                      <button
                        type="button"
                        className="btn text-xs"
                        onClick={() =>
                          setSubscribeKind({
                            kind: addon.monitorKind!,
                            name: addon.name,
                            billingModel: addon.billingModel,
                          })
                        }
                      >
                        Activate on a report
                      </button>
                    ) : addon.stripeConfigured ? (
                      <button
                        type="button"
                        className="btn text-xs"
                        onClick={() =>
                          setSubscribeKind({
                            kind: addon.monitorKind!,
                            name: addon.name,
                            billingModel: addon.billingModel,
                          })
                        }
                      >
                        Subscribe to a report
                      </button>
                    ) : (
                      <span className="text-xs text-amber-400">Stripe price not configured on server</span>
                    )
                  ) : !hasProAccess ? (
                    <Link to="/app/billing" className="btn text-xs">
                      Upgrade to subscribe
                    </Link>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-200">Research run enhancements</h2>
        <p className="text-xs text-slate-500">Selected when starting a run · wallet surcharge if not included in tier</p>
        <div className="grid gap-4 md:grid-cols-2">
          {runAddons.map((addon) => (
            <article key={addon.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <FlaskConical size={16} className="text-accent" />
                  {addon.name}
                </h3>
                <span className="text-xs text-slate-500">{addon.priceLabel}</span>
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">{addon.description}</p>
              {addon.runAddonKey ? (
                <Link
                  to={`/app/research?${RESEARCH_ADDONS_QUERY_KEY}=${encodeURIComponent(addon.runAddonKey)}`}
                  className="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300"
                >
                  Enable on your next research run →
                </Link>
              ) : (
                <Link to="/app/research" className="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300">
                  Open research console →
                </Link>
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-medium text-slate-200">Platform &amp; services</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {platformAddons.map((addon) => (
            <article key={addon.id} className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
              <div className="flex items-baseline justify-between gap-2">
                <h3 className="text-sm font-medium text-slate-200 flex items-center gap-2">
                  <Layers size={16} className="text-accent" />
                  {addon.name}
                </h3>
                {addon.comingSoon ? (
                  <span className="rounded-full bg-white/10 px-2 py-0.5 text-xs text-slate-400">Coming soon</span>
                ) : (
                  <span className="text-xs text-slate-500">{addon.priceLabel}</span>
                )}
              </div>
              <p className="mt-2 text-xs text-slate-400 leading-relaxed">{addon.description}</p>
              {addon.enterpriseMailto ? (
                <a href={addon.enterpriseMailto} className="mt-3 inline-block text-xs text-indigo-400 hover:text-indigo-300">
                  Contact us →
                </a>
              ) : null}
            </article>
          ))}
        </div>
      </section>

      <p className="text-xs text-slate-500">
        <Link to="/app/billing" className="text-indigo-400 hover:text-indigo-300">
          Account &amp; billing
        </Link>{' '}
        ·{' '}
        <Link to="/pricing" className="text-indigo-400 hover:text-indigo-300">
          Public pricing
        </Link>
      </p>

      {subscribeKind ? (
        subscribeKind.billingModel === 'token_pack' && subscribeKind.kind === 'living_report' ? (
          <LivingReportSubscribeModal addonName={subscribeKind.name} onClose={() => setSubscribeKind(null)} />
        ) : (
          <ReportSubscribeModal
            monitorKind={subscribeKind.kind}
            addonName={subscribeKind.name}
            onClose={() => setSubscribeKind(null)}
          />
        )
      ) : null}
    </div>
  );
}
