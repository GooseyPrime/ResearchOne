import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

interface OverviewMetrics {
  days: number;
  signups: number;
  activeRuns: number;
  reportsCompleted7d: number;
  reportsCompleted30d: number;
  tierDistribution: Array<{ tier: string; count: number }>;
  avgCostPerRunUsd: number | null;
  costTelemetry: { available: boolean; reason?: string };
  personaRollup: {
    available: boolean;
    reason?: string;
    days: number;
    personas: Array<{ persona: string; viewCount: number; ctaClickCount: number }>;
  };
}

interface VendorBalances {
  vendors: Array<{
    id: string;
    label: string;
    balanceUsd: number | null;
    status: 'ok' | 'unverified' | 'unavailable';
    detail?: string;
  }>;
}

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${n.toFixed(4)}`;
}

export default function AdminOverview() {
  const [days, setDays] = useState(30);

  const metricsQuery = useQuery({
    queryKey: ['admin-metrics-overview', days],
    queryFn: async () => (await api.get<OverviewMetrics>(`/admin/metrics/overview?days=${days}`)).data,
  });

  const vendorsQuery = useQuery({
    queryKey: ['admin-vendors-balances'],
    queryFn: async () => (await api.get<VendorBalances>('/admin/vendors/balances')).data,
    staleTime: 60_000,
  });

  const metrics = metricsQuery.data;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Operations overview</h2>
          <p className="text-sm text-slate-400">Site activity, tier mix, cost telemetry, and vendor balances.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Window
          <select
            className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {metricsQuery.isLoading ? (
        <p className="text-sm text-slate-400">Loading metrics…</p>
      ) : metricsQuery.isError ? (
        <p className="text-sm text-red-400">Failed to load overview metrics.</p>
      ) : metrics ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <MetricCard label={`Signups (${metrics.days}d)`} value={String(metrics.signups)} />
            <MetricCard label="In-flight runs" value={String(metrics.activeRuns)} />
            <MetricCard label="Reports completed (7d)" value={String(metrics.reportsCompleted7d)} />
            <MetricCard label="Reports completed (30d)" value={String(metrics.reportsCompleted30d)} />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <section className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h3 className="font-medium text-slate-200">Cost per run</h3>
                <Link to="cost" className="text-xs text-indigo-300 hover:text-indigo-200">
                  Open cost analytics →
                </Link>
              </div>
              {metrics.costTelemetry.available ? (
                <p className="text-2xl font-semibold text-white">{fmtUsd(metrics.avgCostPerRunUsd)}</p>
              ) : (
                <p className="text-sm text-amber-300">
                  Cost telemetry unavailable{metrics.costTelemetry.reason ? ` (${metrics.costTelemetry.reason})` : ''}.
                </p>
              )}
            </section>

            <section className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
              <h3 className="mb-3 font-medium text-slate-200">Tier distribution</h3>
              {metrics.tierDistribution.length === 0 ? (
                <p className="text-sm text-slate-500">No tier rows yet.</p>
              ) : (
                <ul className="space-y-1 text-sm">
                  {metrics.tierDistribution.map((row) => (
                    <li key={row.tier} className="flex justify-between text-slate-300">
                      <span>{row.tier}</span>
                      <span>{row.count}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {metrics.personaRollup.available ? (
            <section className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
              <h3 className="mb-3 font-medium text-slate-200">Landing persona rollup ({metrics.personaRollup.days}d)</h3>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead>
                    <tr className="text-slate-400">
                      <th className="pb-2 pr-4">Persona</th>
                      <th className="pb-2 pr-4">Views</th>
                      <th className="pb-2">CTA clicks</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.personaRollup.personas.map((p) => (
                      <tr key={p.persona} className="border-t border-white/5 text-slate-200">
                        <td className="py-2 pr-4">{p.persona}</td>
                        <td className="py-2 pr-4">{p.viewCount}</td>
                        <td className="py-2">{p.ctaClickCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
        </>
      ) : null}

      <section className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
        <h3 className="mb-3 font-medium text-slate-200">Vendor balances</h3>
        {vendorsQuery.isLoading ? (
          <p className="text-sm text-slate-400">Loading vendor balances…</p>
        ) : vendorsQuery.isError ? (
          <p className="text-sm text-red-400">Could not load vendor balances.</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {(vendorsQuery.data?.vendors ?? []).map((vendor) => (
              <div key={vendor.id} className="rounded border border-white/5 bg-slate-950/40 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-slate-200">{vendor.label}</span>
                  <span className="text-sm font-medium text-white">{fmtUsd(vendor.balanceUsd)}</span>
                </div>
                <p className="mt-1 text-xs text-slate-500">
                  {vendor.status === 'ok'
                    ? 'Live balance'
                    : vendor.status === 'unverified'
                      ? 'Unverified — manual check required'
                      : 'Unavailable'}
                  {vendor.detail ? ` — ${vendor.detail}` : ''}
                </p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-4">
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-white">{value}</p>
    </div>
  );
}
