import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, BarChart2, AlertTriangle, Tag, Layers } from 'lucide-react';
import { getStats, getClaims, getContradictions, getClaimTierDistribution } from '../utils/api';
import {
  ResponsiveContainer,
  Tooltip,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import clsx from 'clsx';

const TIER_COLORS: Record<string, string> = {
  established_fact: '#22c55e',
  strong_evidence: '#3b82f6',
  testimony: '#f59e0b',
  inference: '#a855f7',
  speculation: '#ef4444',
};

const TIER_LABELS: Record<string, string> = {
  established_fact: 'Established Fact',
  strong_evidence: 'Strong Evidence',
  testimony: 'Testimony',
  inference: 'Inference',
  speculation: 'Speculation',
};

export default function CorpusPage() {
  const [tab, setTab] = useState<'overview' | 'claims' | 'contradictions'>('overview');
  const [tierFilter, setTierFilter] = useState('');
  const [claimSearch, setClaimSearch] = useState('');
  const [showResolved, setShowResolved] = useState(false);

  const { data: stats } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 15000,
  });

  const { data: tierDistribution = [] } = useQuery({
    queryKey: ['tier-distribution'],
    queryFn: getClaimTierDistribution,
    refetchInterval: 30000,
  });

  const { data: claims = [] } = useQuery({
    queryKey: ['claims', tierFilter, claimSearch],
    queryFn: () => getClaims({ tier: tierFilter || undefined, search: claimSearch || undefined }),
    enabled: tab === 'claims',
  });

  const { data: contradictions = [] } = useQuery({
    queryKey: ['contradictions', showResolved],
    queryFn: () => getContradictions({ resolved: showResolved }),
    enabled: tab === 'contradictions',
  });

  // Build pie chart data from actual API data
  const tierData = tierDistribution.map(t => ({
    name: TIER_LABELS[t.evidence_tier] ?? t.evidence_tier,
    value: t.count,
    tier: t.evidence_tier,
  }));

  return (
    <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white flex items-center gap-3">
          <Database className="text-accent" size={24} />
          Corpus Intelligence
        </h1>
        <p className="text-slate-400 text-sm mt-1">Browse evidence, claims, and contradictions in the research corpus.</p>
      </div>

      {/* Stats cards. node-postgres returns bigint as string by default,
          so we Number()-coerce every count to keep the StatCard visuals
          consistent (also lets the recharts renderers downstream treat
          them as numerics rather than text). */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Sources" value={Number(stats.source_count ?? 0)} icon={Database} />
          <StatCard label="Chunks" value={Number(stats.chunk_count ?? 0)} icon={Layers} />
          <StatCard label="Embeddings" value={Number(stats.embedding_count ?? 0)} icon={BarChart2} />
          <StatCard label="Claims" value={Number(stats.claim_count ?? 0)} icon={Tag} />
          <StatCard label="Contradictions" value={Number(stats.open_contradiction_count ?? 0)} icon={AlertTriangle} color="text-amber-400" />
        </div>
      )}

      {/* DB info */}
      {stats && (
        <div className="flex items-center gap-4 text-xs text-slate-500">
          <span>DB size: <span className="text-slate-300 font-medium">{stats.db_size}</span></span>
          <span>Active runs: <span className="text-accent font-medium">{stats.active_run_count}</span></span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 bg-surface-200 p-1 rounded-lg w-fit">
        {(['overview', 'claims', 'contradictions'] as const).map(t => (
          <button
            key={t}
            className={clsx(
              'px-4 py-1.5 rounded-md text-sm font-medium transition-all',
              tab === t ? 'bg-surface-300 text-white border border-indigo-900/40' : 'text-slate-400 hover:text-white'
            )}
            onClick={() => setTab(t)}
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-white mb-4">Evidence Tier Distribution</h3>
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie
                  data={tierData}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  labelLine={false}
                >
                  {tierData.map((entry, index) => (
                    <Cell key={index} fill={TIER_COLORS[entry.tier]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: '#172033', border: '1px solid rgba(99,102,241,0.2)', borderRadius: '8px' }}
                  labelStyle={{ color: '#fff' }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <div className="card p-5 space-y-3">
            <h3 className="text-sm font-semibold text-white mb-4">Evidence Tier Legend</h3>
            {Object.entries(TIER_LABELS).map(([tier, label]) => (
              <div key={tier} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: TIER_COLORS[tier] }} />
                  <span className="text-sm text-slate-300">{label}</span>
                </div>
                <span className={clsx('badge', `badge-${tier}`)}>{tier}</span>
              </div>
            ))}
            <div className="pt-3 border-t border-indigo-900/20 text-xs text-slate-500">
              Evidence tiers reflect the epistemic weight of each claim. Never treat inferences as facts.
            </div>
          </div>
        </div>
      )}

      {tab === 'claims' && (
        <div className="space-y-4">
          <div className="flex gap-3">
            <input
              className="input flex-1"
              placeholder="Search claims..."
              value={claimSearch}
              onChange={e => setClaimSearch(e.target.value)}
            />
            <select
              className="input w-48"
              value={tierFilter}
              onChange={e => setTierFilter(e.target.value)}
            >
              <option value="">All Tiers</option>
              {Object.entries(TIER_LABELS).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </div>
          <div className="space-y-2">
            {claims.map(claim => (
              <div key={claim.id} className="card p-4 space-y-2">
                <p className="text-sm text-slate-200">{claim.claim_text}</p>
                <div className="flex items-center gap-3 text-xs text-slate-500">
                  <span className={clsx('badge', `badge-${claim.evidence_tier}`)}>
                    {TIER_LABELS[claim.evidence_tier] ?? claim.evidence_tier}
                  </span>
                  {claim.source_title && <span>Source: {claim.source_title}</span>}
                  <span>Confidence: {(claim.confidence * 100).toFixed(0)}%</span>
                </div>
              </div>
            ))}
            {claims.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-8">No claims found.</p>
            )}
          </div>
        </div>
      )}

      {tab === 'contradictions' && (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={showResolved}
                onChange={e => setShowResolved(e.target.checked)}
                className="rounded"
              />
              Show resolved
            </label>
          </div>
          <div className="space-y-3">
            {contradictions.map(c => (
              <div key={c.id} className="card p-5 border-amber-900/20 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <AlertTriangle size={14} className="text-amber-400" />
                    <span className="text-xs font-semibold text-amber-400 uppercase tracking-wider">
                      {c.severity} contradiction
                    </span>
                  </div>
                  {c.resolved && (
                    <span className="badge bg-green-900/20 text-green-400 border border-green-800/30">Resolved</span>
                  )}
                </div>
                <p className="text-sm text-slate-300">{c.description}</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-surface-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Claim A</div>
                    <p className="text-xs text-slate-300">{c.claim_a_text}</p>
                  </div>
                  <div className="bg-surface-200 rounded-lg p-3">
                    <div className="text-xs text-slate-500 mb-1">Claim B</div>
                    <p className="text-xs text-slate-300">{c.claim_b_text}</p>
                  </div>
                </div>
              </div>
            ))}
            {contradictions.length === 0 && (
              <p className="text-slate-500 text-sm text-center py-8">No contradictions found.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({
  label, value, icon: Icon, color = 'text-accent'
}: {
  label: string;
  value: number | string;
  icon: React.ElementType;
  color?: string;
}) {
  return (
    <div className="card p-4 flex items-center gap-3">
      <div className={clsx('p-2 rounded-lg bg-surface-200', color)}>
        <Icon size={16} />
      </div>
      <div>
        <div className="text-lg font-bold text-white">{typeof value === 'number' ? value.toLocaleString() : value}</div>
        <div className="text-xs text-slate-500">{label}</div>
      </div>
    </div>
  );
}
