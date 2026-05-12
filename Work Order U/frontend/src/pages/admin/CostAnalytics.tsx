import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar,
  PieChart, Pie, Cell,
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { DollarSign, Zap, RotateCw, FileText, AlertCircle } from 'lucide-react';
import api from '../../utils/api';

// Phase color palette — stable across the page so the pie/bar/breakdown
// chart agrees with the table's `topPhase` badge. Matches the canonical
// PipelinePhase enum in backend/src/services/telemetry/costSidecar.ts.
const PHASE_COLORS: Record<string, string> = {
  'Planning': '#60a5fa',                  // blue-400
  'Discovery': '#a78bfa',                 // violet-400
  'Retrieval': '#34d399',                 // emerald-400
  'Reasoning': '#fbbf24',                 // amber-400
  'Skeptic': '#f87171',                   // red-400
  'Synthesis': '#22d3ee',                 // cyan-400
  'Verification': '#10b981',              // emerald-500
  'Plain Language': '#fb923c',            // orange-400
  'Claim Extraction': '#c084fc',          // purple-400
  'Contradiction Extraction': '#e879f9',  // fuchsia-400
  'Citation Mapping': '#5eead4',          // teal-300
  'Report Generation': '#818cf8',         // indigo-400
  'Revision': '#fbbf24',                  // amber-400
  'Other': '#94a3b8',                     // slate-400
};
const FALLBACK_COLOR = '#64748b';

function fmtUsd(n: number, frac = 4): string {
  if (!isFinite(n)) return '$0';
  // Sub-cent precision for tiny aggregates; condensed for big ones.
  if (n >= 1000) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
  if (n >= 1) return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  return `$${n.toFixed(frac)}`;
}

function fmtInt(n: number): string {
  if (!isFinite(n)) return '0';
  return n.toLocaleString();
}

function fmtPct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}

// ─── API response shapes ─────────────────────────────────────────────

interface SummaryResponse {
  available: boolean;
  reason?: string;
  days?: number;
  totals?: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCostUsd: number;
    totalDurationMs: number;
    distinctRuns: number;
    distinctReports: number;
    fallbackCalls: number;
  };
  derived?: {
    avgCostPerRunUsd: number;
    avgCallsPerRun: number;
    fallbackRate: number;
  };
}

interface TimeseriesResponse {
  available: boolean;
  reason?: string;
  points: Array<{
    day: string;
    totalCostUsd: number;
    totalTokens: number;
    callCount: number;
    distinctRuns: number;
  }>;
}

interface BreakdownResponse {
  available: boolean;
  reason?: string;
  dimension?: string;
  buckets: Array<{
    bucket: string;
    totalCostUsd: number;
    totalTokens: number;
    callCount: number;
  }>;
}

interface ReportsResponse {
  available: boolean;
  reason?: string;
  rows: Array<{
    runId: string;
    reportId: string | null;
    userId: string | null;
    runTitle: string | null;
    runStatus: string | null;
    researchObjective: string | null;
    callCount: number;
    totalTokens: number;
    totalDurationMs: number;
    totalCostUsd: number;
    fallbackCalls: number;
    firstCallAt: string;
    lastCallAt: string;
    topPhase: string | null;
  }>;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function CostAnalytics() {
  const [days, setDays] = useState(30);
  const [dimension, setDimension] = useState<'phase' | 'role' | 'model'>('phase');
  const [userFilter, setUserFilter] = useState('');
  const [phaseFilter, setPhaseFilter] = useState('');

  const summary = useQuery({
    queryKey: ['admin-cost-summary', days],
    queryFn: async () =>
      (await api.get(`/admin/cost/summary?days=${days}`)).data as SummaryResponse,
  });

  const timeseries = useQuery({
    queryKey: ['admin-cost-timeseries', days],
    queryFn: async () =>
      (await api.get(`/admin/cost/timeseries?days=${days}`)).data as TimeseriesResponse,
  });

  const breakdown = useQuery({
    queryKey: ['admin-cost-breakdown', days, dimension],
    queryFn: async () =>
      (await api.get(`/admin/cost/breakdown?days=${days}&dimension=${dimension}`)).data as BreakdownResponse,
  });

  const reports = useQuery({
    queryKey: ['admin-cost-reports', days, userFilter, phaseFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ days: String(days), limit: '50' });
      if (userFilter.trim()) params.set('userId', userFilter.trim());
      if (phaseFilter.trim()) params.set('phase', phaseFilter.trim());
      return (await api.get(`/admin/cost/reports?${params.toString()}`)).data as ReportsResponse;
    },
  });

  const migrationPending = useMemo(
    () => summary.data?.available === false && summary.data?.reason === 'migration_pending',
    [summary.data]
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Cost Analytics</h2>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white"
        >
          <option value={1}>1 day</option>
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
          <option value={365}>1 year</option>
        </select>
      </div>

      {migrationPending && (
        <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-none" />
          <div>
            <div className="font-medium">Cost telemetry not yet available</div>
            <div className="text-amber-300/80 mt-1">
              Migration 030 has not been applied. Run{' '}
              <code className="px-1.5 py-0.5 rounded bg-slate-900">npm run migrate</code>{' '}
              in the backend, then refresh.
            </div>
          </div>
        </div>
      )}

      {/* KPI Scorecards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard
          label="Total Cost"
          value={fmtUsd(summary.data?.totals?.totalCostUsd ?? 0)}
          sublabel={`${fmtInt(summary.data?.totals?.distinctRuns ?? 0)} runs`}
          icon={<DollarSign className="w-4 h-4" />}
          accent="text-emerald-400"
        />
        <KpiCard
          label="Avg Cost / Run"
          value={fmtUsd(summary.data?.derived?.avgCostPerRunUsd ?? 0)}
          sublabel={`${(summary.data?.derived?.avgCallsPerRun ?? 0).toFixed(1)} calls/run`}
          icon={<FileText className="w-4 h-4" />}
          accent="text-cyan-400"
        />
        <KpiCard
          label="Total Tokens"
          value={fmtInt(
            (summary.data?.totals?.totalInputTokens ?? 0) +
              (summary.data?.totals?.totalOutputTokens ?? 0)
          )}
          sublabel={`${fmtDuration(summary.data?.totals?.totalDurationMs ?? 0)} compute`}
          icon={<Zap className="w-4 h-4" />}
          accent="text-amber-400"
        />
        <KpiCard
          label="Fallback Rate"
          value={fmtPct(summary.data?.derived?.fallbackRate ?? 0)}
          sublabel={`${fmtInt(summary.data?.totals?.fallbackCalls ?? 0)} fallback calls`}
          icon={<RotateCw className="w-4 h-4" />}
          accent="text-red-400"
        />
      </div>

      {/* Time series */}
      <Panel title="Cost over time">
        <div className="h-64">
          {timeseries.data?.points && timeseries.data.points.length > 0 ? (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={timeseries.data.points}>
                <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                <XAxis dataKey="day" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                <YAxis
                  stroke="#94a3b8"
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => fmtUsd(v, 2)}
                />
                <Tooltip
                  contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}
                  formatter={(v: number) => fmtUsd(v, 4)}
                />
                <Line
                  type="monotone"
                  dataKey="totalCostUsd"
                  name="Cost"
                  stroke="#10b981"
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          ) : (
            <EmptyState message="No cost data in this window yet." />
          )}
        </div>
      </Panel>

      {/* Breakdown — pie + bar side by side */}
      <Panel title="Cost breakdown">
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs text-slate-400">by</span>
          {(['phase', 'role', 'model'] as const).map((d) => (
            <button
              key={d}
              onClick={() => setDimension(d)}
              className={`text-xs px-2.5 py-1 rounded ${
                dimension === d
                  ? 'bg-slate-700 text-white'
                  : 'bg-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {d}
            </button>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <div className="h-64">
            {breakdown.data?.buckets && breakdown.data.buckets.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={breakdown.data.buckets}
                    dataKey="totalCostUsd"
                    nameKey="bucket"
                    cx="50%"
                    cy="50%"
                    outerRadius={90}
                    label={(e) => e.bucket}
                  >
                    {breakdown.data.buckets.map((b, i) => (
                      <Cell
                        key={i}
                        fill={PHASE_COLORS[b.bucket] ?? FALLBACK_COLOR}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}
                    formatter={(v: number) => fmtUsd(v, 4)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No breakdown data." />
            )}
          </div>
          <div className="h-64">
            {breakdown.data?.buckets && breakdown.data.buckets.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={breakdown.data.buckets}
                  margin={{ left: 0, right: 12, top: 8, bottom: 32 }}
                >
                  <CartesianGrid stroke="#1e293b" strokeDasharray="3 3" />
                  <XAxis
                    dataKey="bucket"
                    stroke="#94a3b8"
                    tick={{ fontSize: 10 }}
                    angle={-30}
                    textAnchor="end"
                    interval={0}
                  />
                  <YAxis
                    stroke="#94a3b8"
                    tick={{ fontSize: 11 }}
                    tickFormatter={(v) => fmtUsd(v, 2)}
                  />
                  <Tooltip
                    contentStyle={{ background: '#0f172a', border: '1px solid #334155', borderRadius: 6 }}
                    formatter={(v: number) => fmtUsd(v, 4)}
                  />
                  <Bar dataKey="totalCostUsd" name="Cost">
                    {breakdown.data.buckets.map((b, i) => (
                      <Cell
                        key={i}
                        fill={PHASE_COLORS[b.bucket] ?? FALLBACK_COLOR}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState message="No breakdown data." />
            )}
          </div>
        </div>
      </Panel>

      {/* Per-run cost table */}
      <Panel title="Per-run cost rollup">
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <input
            type="text"
            placeholder="Filter by user id…"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
            className="rounded bg-slate-800 border border-white/10 px-2 py-1 text-xs text-white placeholder:text-slate-500"
          />
          <select
            value={phaseFilter}
            onChange={(e) => setPhaseFilter(e.target.value)}
            className="rounded bg-slate-800 border border-white/10 px-2 py-1 text-xs text-white"
          >
            <option value="">All phases</option>
            {Object.keys(PHASE_COLORS).map((p) => (
              <option key={p} value={p}>{p}</option>
            ))}
          </select>
          {(userFilter || phaseFilter) && (
            <button
              onClick={() => { setUserFilter(''); setPhaseFilter(''); }}
              className="text-xs text-slate-400 hover:text-white px-2 py-1"
            >
              Clear
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-left text-slate-400 border-b border-white/10">
                <th className="py-2 pr-2">Run</th>
                <th className="pr-2">User</th>
                <th className="pr-2">Objective</th>
                <th className="pr-2 text-right">Cost</th>
                <th className="pr-2 text-right">Tokens</th>
                <th className="pr-2 text-right">Duration</th>
                <th className="pr-2 text-right">Calls</th>
                <th className="pr-2">Top Phase</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {reports.data?.rows?.map((r) => (
                <tr key={r.runId} className="border-b border-white/5">
                  <td className="py-1.5 pr-2 font-mono text-[10px] text-slate-300" title={r.runId}>
                    {r.runId.slice(0, 8)}…
                  </td>
                  <td className="pr-2 font-mono text-[10px] text-slate-400">
                    {r.userId ? `${r.userId.slice(0, 10)}…` : '—'}
                  </td>
                  <td className="pr-2 text-slate-300">{r.researchObjective ?? 'v1'}</td>
                  <td className="pr-2 text-right text-emerald-300 font-medium">
                    {fmtUsd(r.totalCostUsd, 4)}
                  </td>
                  <td className="pr-2 text-right text-slate-300">{fmtInt(r.totalTokens)}</td>
                  <td className="pr-2 text-right text-slate-400">{fmtDuration(r.totalDurationMs)}</td>
                  <td className="pr-2 text-right text-slate-400">
                    {r.callCount}
                    {r.fallbackCalls > 0 && (
                      <span className="text-amber-400 ml-1" title={`${r.fallbackCalls} fallback calls`}>
                        ↻{r.fallbackCalls}
                      </span>
                    )}
                  </td>
                  <td className="pr-2">
                    {r.topPhase && (
                      <span
                        className="inline-block px-1.5 py-0.5 rounded text-[10px]"
                        style={{
                          background: `${PHASE_COLORS[r.topPhase] ?? FALLBACK_COLOR}33`,
                          color: PHASE_COLORS[r.topPhase] ?? FALLBACK_COLOR,
                        }}
                      >
                        {r.topPhase}
                      </span>
                    )}
                  </td>
                  <td>
                    <span
                      className={`text-[10px] ${
                        r.runStatus === 'completed' ? 'text-emerald-400'
                          : r.runStatus === 'failed' ? 'text-red-400'
                          : 'text-slate-400'
                      }`}
                    >
                      {r.runStatus ?? '—'}
                    </span>
                  </td>
                </tr>
              ))}
              {(!reports.data?.rows || reports.data.rows.length === 0) && (
                <tr>
                  <td colSpan={9} className="py-4 text-center text-slate-500">
                    No runs match the current filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Panel>
    </div>
  );
}

// ─── Subcomponents ───────────────────────────────────────────────────

function KpiCard({
  label, value, sublabel, icon, accent,
}: {
  label: string; value: string; sublabel?: string;
  icon?: React.ReactNode; accent?: string;
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/50 p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="text-xs text-slate-400">{label}</div>
        {icon && <div className={accent ?? 'text-slate-400'}>{icon}</div>}
      </div>
      <div className={`text-xl font-semibold ${accent ?? 'text-white'}`}>{value}</div>
      {sublabel && <div className="text-[10px] text-slate-500 mt-0.5">{sublabel}</div>}
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-white/10 bg-slate-900/30 p-4">
      <h3 className="text-sm font-medium text-slate-300 mb-3">{title}</h3>
      {children}
    </div>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="h-full flex items-center justify-center text-xs text-slate-500">
      {message}
    </div>
  );
}
