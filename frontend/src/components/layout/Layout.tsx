import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  FlaskConical,
  BookOpen,
  Database,
  Layers,
  Network,
  LayoutGrid,
  Upload,
  HelpCircle,
  Activity,
  Cpu,
  Settings,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { UserButton } from '@clerk/clerk-react';
import { getStats, getSystemHealth, restartRuntime, getResearchRuns, type ResearchRun } from '../../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../../utils/apiRateLimit';
import { useStore } from '../../store/useStore';
import { useCallback, useEffect, useState } from 'react';
import { getSocket, subscribeToCorpus } from '../../utils/socket';
import Notifications from '../ui/Notifications';
import ActiveRunBadge from '../research/ActiveRunBadge';
import SystemStatusModal from './SystemStatusModal';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/app/research', label: 'Research', icon: FlaskConical, desc: 'Start investigation' },
  { to: '/app/research-v2', label: 'Research One 2', icon: FlaskConical, desc: 'V2 frontier ensemble' },
  { to: '/app/reports', label: 'Reports', icon: BookOpen, desc: 'Report library' },
  { to: '/app/corpus', label: 'Corpus', icon: Database, desc: 'Browse evidence' },
  { to: '/app/atlas', label: 'Atlas', icon: Layers, desc: 'Embedding export (Nomic)' },
  { to: '/app/embedding-viz', label: 'Embedding Viz', icon: LayoutGrid, desc: 'In-browser vector atlas' },
  { to: '/app/knowledge-graph', label: 'Knowledge Graph', icon: Network, desc: 'Claims & source graph' },
  { to: '/app/ingest', label: 'Ingest', icon: Upload, desc: 'Add sources' },
  { to: '/app/guide', label: 'Guide', icon: HelpCircle, desc: 'How to use' },
  { to: '/app/guide/research-v2', label: 'Research One 2 guide', icon: HelpCircle, desc: 'V2 research modes' },
  { to: '/app/models', label: 'Models', icon: Settings, desc: 'Model routing (admin)' },
];
const MAX_RESTART_POLL_ATTEMPTS = 12;
const RESTART_POLL_INTERVAL_MS = 2500;

/** Stable fallback so useQuery `data` being undefined does not allocate a new [] each render (would loop setActiveRun → React #185). */
const EMPTY_RESEARCH_RUNS: ResearchRun[] = [];

export default function Layout() {
  const location = useLocation();
  const queryClient = useQueryClient();
  const { setStats, stats, setActiveRun } = useStore();
  const [healthOpen, setHealthOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(20_000),
  });

  useEffect(() => {
    if (data) setStats(data);
  }, [data, setStats]);


  const { data: liveRuns } = useQuery<ResearchRun[]>({
    queryKey: ['layout-active-runs'],
    queryFn: () => getResearchRuns({ status: 'running' }),
    refetchInterval: () => getAdaptiveRefetchIntervalMs(6_000),
  });

  useEffect(() => {
    const runs = liveRuns ?? EMPTY_RESEARCH_RUNS;
    if (runs.length === 0) {
      setActiveRun(null);
      return;
    }
    const top = runs[0];
    setActiveRun({
      runId: top.id,
      stage: top.progress_stage || 'running',
      percent: top.progress_percent ?? 0,
      message: top.progress_message || 'Running…',
      timestamp: top.progress_updated_at || new Date().toISOString(),
    });
  }, [liveRuns, setActiveRun]);

  const {
    data: health,
    isPending: healthPending,
    isFetching: healthFetching,
    isError: healthIsError,
    error: healthError,
    refetch: refetchHealth,
  } = useQuery({
    queryKey: ['system-health'],
    queryFn: getSystemHealth,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(20_000),
  });

  const refreshHealth = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['system-health'] });
    void refetchHealth();
  }, [queryClient, refetchHealth]);

  // Connect WebSocket
  useEffect(() => {
    const socket = getSocket();
    subscribeToCorpus();

    socket.on('corpus:updated', () => {
      window.dispatchEvent(new CustomEvent('corpus:updated'));
    });

    return () => {
      socket.off('corpus:updated');
    };
  }, []);

  const overallColor = healthIsError
    ? 'bg-red-400'
    : health?.status === 'ok'
      ? 'bg-green-400'
      : health?.status === 'degraded'
        ? 'bg-amber-400'
        : health?.status === 'down'
          ? 'bg-red-400'
          : 'bg-slate-500';

  const statusLabel = healthIsError
    ? 'unreachable'
    : healthPending && !health
      ? 'checking'
      : health?.status ?? 'checking';

  const handleRestart = async () => {
    const token = window.prompt('Enter admin runtime token to restart the system');
    if (!token) return;
    if (!window.confirm('Restart runtime now? Active jobs may be interrupted.')) return;
    setRestartBusy(true);
    try {
      await restartRuntime(token);
      for (let i = 0; i < MAX_RESTART_POLL_ATTEMPTS; i++) {
        await new Promise(resolve => setTimeout(resolve, RESTART_POLL_INTERVAL_MS));
        try {
          const nextHealth = await getSystemHealth();
          if (nextHealth.status !== 'down') break;
        } catch {
          // continue polling while runtime restarts
        }
      }
      refreshHealth();
    } finally {
      setRestartBusy(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <aside className="w-60 flex-shrink-0 border-r border-indigo-900/20 flex flex-col bg-surface-300">
        <div className="p-5 border-b border-indigo-900/20">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-research-teal flex items-center justify-center glow-accent">
              <Cpu size={16} className="text-white" />
            </div>
            <div>
              <div className="font-bold text-white text-sm leading-tight">ResearchOne</div>
              <div className="text-xs text-slate-500 leading-tight">Anomaly Intelligence</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {NAV_ITEMS.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                clsx(isActive ? 'nav-item-active' : 'nav-item')
              }
            >
              <item.icon size={16} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        {stats && (
          <div className="p-3 border-t border-indigo-900/20 space-y-2">
            <div className="section-title mb-2">Corpus</div>
            <div className="grid grid-cols-2 gap-2">
              <StatPill label="Sources" value={stats.source_count} />
              <StatPill label="Chunks" value={stats.chunk_count} />
              <StatPill label="Claims" value={stats.claim_count} />
              <StatPill label="Reports" value={stats.finalized_report_count} />
            </div>
            {stats.active_run_count > 0 && (
              <div className="flex items-center gap-2 mt-2 px-2 py-1 rounded-md bg-accent/10 border border-accent/20">
                <Activity size={12} className="text-accent animate-pulse" />
                <span className="text-xs text-accent font-medium">{stats.active_run_count} run active</span>
              </div>
            )}
          </div>
        )}
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="h-12 border-b border-indigo-900/20 flex items-center justify-between px-6 bg-surface-300/50 glass flex-shrink-0">
          <div className="text-sm text-slate-400">
            {NAV_ITEMS.find(n => location.pathname.startsWith(n.to))?.desc ?? 'ResearchOne'}
          </div>
          <div className="flex items-center gap-3">
            <ActiveRunBadge />
            <UserButton afterSignOutUrl='/' />
            <button
              type="button"
              className="flex items-center gap-1.5 rounded-md px-1 py-0.5 hover:bg-surface-200/50"
              onClick={() => setHealthOpen(true)}
              aria-expanded={healthOpen}
              aria-haspopup="dialog"
            >
              <div
                className={clsx(
                  'w-1.5 h-1.5 rounded-full',
                  healthFetching && 'animate-pulse',
                  overallColor
                )}
              />
              <span className="text-xs text-slate-500">System {statusLabel}</span>
            </button>
          </div>
        </header>

        <main className="flex-1 overflow-y-auto grid-bg">
          <Outlet />
        </main>
      </div>

      <SystemStatusModal
        open={healthOpen}
        onClose={() => setHealthOpen(false)}
        health={health}
        healthLoading={healthPending}
        healthError={healthIsError ? (healthError instanceof Error ? healthError : new Error(String(healthError))) : null}
        onRefreshHealth={refreshHealth}
        onRestart={handleRestart}
        restartBusy={restartBusy}
      />

      <Notifications />
    </div>
  );
}

function StatPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-surface-200 rounded-md px-2 py-1.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="text-sm font-semibold text-white">{value.toLocaleString()}</div>
    </div>
  );
}
