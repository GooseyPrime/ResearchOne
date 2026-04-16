import { Outlet, NavLink, useLocation } from 'react-router-dom';
import {
  FlaskConical,
  BookOpen,
  Database,
  Layers,
  Upload,
  HelpCircle,
  Activity,
  Cpu,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { getStats, getSystemHealth, restartRuntime } from '../../utils/api';
import { useStore } from '../../store/useStore';
import { useEffect, useState } from 'react';
import { getSocket, subscribeToCorpus } from '../../utils/socket';
import Notifications from '../ui/Notifications';
import ActiveRunBadge from '../research/ActiveRunBadge';
import clsx from 'clsx';

const NAV_ITEMS = [
  { to: '/research', label: 'Research', icon: FlaskConical, desc: 'Start investigation' },
  { to: '/reports', label: 'Reports', icon: BookOpen, desc: 'Report library' },
  { to: '/corpus', label: 'Corpus', icon: Database, desc: 'Browse evidence' },
  { to: '/atlas', label: 'Atlas', icon: Layers, desc: 'Embedding explorer' },
  { to: '/ingest', label: 'Ingest', icon: Upload, desc: 'Add sources' },
  { to: '/guide', label: 'Guide', icon: HelpCircle, desc: 'How to use' },
];
const MAX_RESTART_POLL_ATTEMPTS = 12;
const RESTART_POLL_INTERVAL_MS = 2500;

export default function Layout() {
  const location = useLocation();
  const { setStats, stats } = useStore();
  const [healthOpen, setHealthOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);

  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: 15000,
  });

  useEffect(() => {
    if (data) setStats(data);
  }, [data, setStats]);

  const { data: health } = useQuery({
    queryKey: ['system-health'],
    queryFn: getSystemHealth,
    refetchInterval: 10000,
  });

  // Connect WebSocket
  useEffect(() => {
    const socket = getSocket();
    subscribeToCorpus();

    socket.on('corpus:updated', () => {
      // Trigger refetch via invalidation
      window.dispatchEvent(new CustomEvent('corpus:updated'));
    });

    return () => {
      socket.off('corpus:updated');
    };
  }, []);

  const overallColor = health?.status === 'ok'
    ? 'bg-green-400'
    : health?.status === 'degraded'
      ? 'bg-amber-400'
      : 'bg-red-400';

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
    } finally {
      setRestartBusy(false);
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className="w-60 flex-shrink-0 border-r border-indigo-900/20 flex flex-col bg-surface-300">
        {/* Logo */}
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

        {/* Navigation */}
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

        {/* Corpus mini-stats */}
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

      {/* ── Main content ────────────────────────────────────────────────── */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Top bar */}
        <header className="h-12 border-b border-indigo-900/20 flex items-center justify-between px-6 bg-surface-300/50 glass flex-shrink-0">
          <div className="text-sm text-slate-400">
            {NAV_ITEMS.find(n => location.pathname.startsWith(n.to))?.desc ?? 'ResearchOne'}
          </div>
          <div className="flex items-center gap-3">
            <ActiveRunBadge />
            <button
              type="button"
              className="flex items-center gap-1.5"
              onClick={() => setHealthOpen(v => !v)}
            >
              <div className={clsx('w-1.5 h-1.5 rounded-full animate-pulse', overallColor)} />
              <span className="text-xs text-slate-500">System {health?.status ?? 'checking'}</span>
            </button>
          </div>
        </header>

        {healthOpen && health && (
          <div className="border-b border-indigo-900/20 px-6 py-3 bg-surface-300/30">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {Object.entries(health.checks).map(([name, check]) => (
                <div key={name} className="bg-surface-200 rounded-md px-2 py-1.5 text-xs">
                  <div className="text-slate-500">{name}</div>
                  <div className={check.ok ? 'text-green-400' : 'text-red-400'}>{check.ok ? 'ok' : 'down'}</div>
                </div>
              ))}
            </div>
            {health.restartAvailable && (
              <button
                type="button"
                className="btn-ghost mt-3 text-xs"
                disabled={restartBusy}
                onClick={handleRestart}
              >
                {restartBusy ? 'Restarting...' : 'Restart runtime'}
              </button>
            )}
          </div>
        )}

        {/* Page content */}
        <main className="flex-1 overflow-y-auto grid-bg">
          <Outlet />
        </main>
      </div>

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
