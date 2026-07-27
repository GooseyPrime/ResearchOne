import { Outlet, NavLink, Link, useLocation, useSearchParams } from 'react-router-dom';
import type { LucideIcon } from 'lucide-react';
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
  Wallet,
  Package,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth, UserButton } from '@clerk/react';
import { useBillingSubscriptionQuery, effectiveEntitlementTier } from '../../hooks/useBillingSubscription';
import { useHasPrivateCorpusAccess } from '../../hooks/useHasPrivateCorpusAccess';
import { useEnsureUserSynced } from '../../hooks/useEnsureUserSynced';
import api, {
  getStats,
  getSystemHealth,
  readBreakGlassAdminTokenFromSession,
  restartRuntime,
  getResearchRuns,
  type ResearchRun,
} from '../../utils/api';
import { getAdaptiveRefetchIntervalMs } from '../../utils/apiRateLimit';
import { hasInFlightResearchRuns, IN_FLIGHT_RUN_STATUSES } from '../../utils/researchRuns';
import { useStore } from '../../store/useStore';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { getSocket, subscribeToCorpus } from '../../utils/socket';
import Notifications from '../ui/Notifications';
import NotificationBanner from '../ui/NotificationBanner';
import ActiveRunBadge from '../research/ActiveRunBadge';
import PlanReviewBanner from './PlanReviewBanner';
import { useGlobalPlanReadyNotify } from '../../hooks/useGlobalPlanReadyNotify';
import SystemStatusModal from './SystemStatusModal';
import clsx from 'clsx';
import { BugNoteProvider } from '../integrations/BugNoteProvider';
import { parseRunIdFromSearchParams } from '../../utils/researchRunRoutes';

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  desc: string;
  requireAdmin?: boolean;
  requireTier?: 'pro';
  /** Private Ingest workspace — `corpusAccess` tiers only (not the same as general Pro nav). */
  requirePrivateCorpus?: boolean;
};

const PRO_PLUS_TIERS = ['pro', 'team', 'byok', 'sovereign', 'admin'] as const;

const NAV_ITEMS: NavItem[] = [
  { to: '/app/research', label: 'Research', icon: FlaskConical, desc: 'Standard and Deep Research' },
  { to: '/app/dossiers', label: 'Dossiers', icon: BookOpen, desc: 'Research dossier library' },
  { to: '/app/add-ons', label: 'Add-ons', icon: Package, desc: 'Catalog, purchase & manage add-ons', requireTier: 'pro' },
  { to: '/app/corpus', label: 'Corpus', icon: Database, desc: 'Browse sources', requireTier: 'pro' },
  { to: '/app/atlas', label: 'Atlas', icon: Layers, desc: 'Embedding export (Nomic)', requireTier: 'pro' },
  { to: '/app/embedding-viz', label: 'Embedding Viz', icon: LayoutGrid, desc: 'In-browser vector atlas', requireTier: 'pro' },
  { to: '/app/knowledge-graph', label: 'Knowledge Graph', icon: Network, desc: 'Claims & source graph', requireTier: 'pro' },
  { to: '/app/ingest', label: 'Ingest', icon: Upload, desc: 'Private corpus ingest', requirePrivateCorpus: true },
  { to: '/app/guide', label: 'Guide', icon: HelpCircle, desc: 'How to use' },
  { to: '/app/billing', label: 'Account', icon: Wallet, desc: 'Account and subscription' },
  { to: '/app/models', label: 'Models', icon: Settings, desc: 'Model routing (admin)', requireAdmin: true },
];
const MAX_RESTART_POLL_ATTEMPTS = 12;
const RESTART_POLL_INTERVAL_MS = 2500;

/** Stable fallback so useQuery `data` being undefined does not allocate a new [] each render (would loop setActiveRun → React #185). */
const EMPTY_RESEARCH_RUNS: ResearchRun[] = [];

export default function Layout() {
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const activeNavItem = useMemo(
    () => NAV_ITEMS.find((n) => location.pathname.startsWith(n.to)),
    [location.pathname]
  );
  const queryClient = useQueryClient();
  const { setStats, stats, setActiveRun, activeRun } = useStore();
  const [healthOpen, setHealthOpen] = useState(false);
  const [restartBusy, setRestartBusy] = useState(false);
  const [breakGlassToken, setBreakGlassToken] = useState<string | undefined>(() =>
    readBreakGlassAdminTokenFromSession(),
  );
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  useEnsureUserSynced();

  const { data: authMe } = useQuery({
    queryKey: ['auth', 'me'],
    queryFn: () => api.get<{ userId: string; isAdmin: boolean }>('/auth/me').then((r) => r.data),
    enabled: Boolean(authLoaded && isSignedIn),
    staleTime: 60_000,
    retry: false,
  });

  const isAllowlistedAdmin = authMe?.isAdmin === true;
  const canViewSystemStatusDetails = isAllowlistedAdmin;

  const { data: subscriptionData, isLoading: subLoading, isError: subError } = useBillingSubscriptionQuery();

  const effectiveTier = effectiveEntitlementTier(subscriptionData);
  /** While the subscription query is in flight, do not treat the user as free_demo (paid users would see a flash of hidden nav). */
  const tierGateUnknown =
    !isAllowlistedAdmin && (subLoading || (Boolean(subError) && !subscriptionData));
  const hasProAccess =
    isAllowlistedAdmin ||
    tierGateUnknown ||
    (Boolean(subscriptionData) &&
      (PRO_PLUS_TIERS as readonly string[]).includes(effectiveTier ?? 'free_demo'));

  const { hasPrivateCorpusAccess, tierGateUnknown: corpusTierUnknown } = useHasPrivateCorpusAccess();

  const visibleNavItems = NAV_ITEMS.filter((item) => {
    if (item.requireAdmin && !isAllowlistedAdmin) return false;
    if (item.requireTier === 'pro' && !hasProAccess) return false;
    if (item.requirePrivateCorpus && !corpusTierUnknown && !hasPrivateCorpusAccess) return false;
    return true;
  });

  const { data } = useQuery({
    queryKey: ['stats'],
    queryFn: getStats,
    refetchInterval: () => getAdaptiveRefetchIntervalMs(20_000),
  });

  useEffect(() => {
    if (data) setStats(data);
  }, [data, setStats]);


  const { data: allRuns } = useQuery<ResearchRun[]>({
    queryKey: ['research-runs'],
    queryFn: () => getResearchRuns(),
    refetchInterval: (query) =>
      hasInFlightResearchRuns(query.state.data)
        ? getAdaptiveRefetchIntervalMs(6_000)
        : false,
  });

  useEffect(() => {
    const runs = allRuns ?? EMPTY_RESEARCH_RUNS;
    const inFlight = runs.filter((r) =>
      (IN_FLIGHT_RUN_STATUSES as readonly string[]).includes(r.status)
    );
    if (inFlight.length === 0) {
      setActiveRun(null);
      return;
    }
    const priority = (s: string) =>
      s === 'plan_pending_confirmation' ? 0 : s === 'running' ? 1 : 2;
    const top = [...inFlight].sort((a, b) => priority(a.status) - priority(b.status))[0];
    setActiveRun({
      runId: top.id,
      stage: top.progress_stage || top.status || 'running',
      percent: top.progress_percent ?? 0,
      message:
        top.status === 'plan_pending_confirmation'
          ? top.progress_message || 'Plan ready — review required'
          : top.progress_message || 'Running…',
      timestamp: top.progress_updated_at || new Date().toISOString(),
    });
  }, [allRuns, setActiveRun]);

  useGlobalPlanReadyNotify(allRuns);

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

  const overallColor = canViewSystemStatusDetails
    ? healthIsError
      ? 'bg-red-400'
      : health?.status === 'ok'
        ? 'bg-green-400'
        : health?.status === 'degraded'
          ? 'bg-amber-400'
          : health?.status === 'down'
            ? 'bg-red-400'
            : 'bg-slate-500'
    : health?.status === 'ok'
      ? 'bg-green-400'
      : 'bg-red-400';

  const statusLabel = healthIsError
    ? 'unreachable'
    : healthPending && !health
      ? 'checking'
      : health?.status ?? 'checking';

  const urlRunId = parseRunIdFromSearchParams(searchParams);
  const bugNoteRunId = urlRunId ?? activeRun?.runId ?? null;

  const handleRestart = async () => {
    if (!window.confirm('Restart runtime now? Active jobs may be interrupted.')) return;
    setRestartBusy(true);
    try {
      await restartRuntime(isAllowlistedAdmin ? undefined : breakGlassToken);
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
    <BugNoteProvider
      userId={authMe?.userId ?? null}
      route={location.pathname}
      runId={bugNoteRunId}
    >
    <div className="flex h-screen overflow-hidden bg-[var(--color-bg)]">
      <aside className="w-60 flex-shrink-0 border-r border-indigo-900/20 flex flex-col bg-surface-300">
        <div className="p-5 border-b border-indigo-900/20">
          <Link
            to="/app/research"
            className="flex items-center gap-3 rounded-lg p-1 -m-1 outline-offset-2 hover:bg-surface-200/40 transition-colors focus-visible:outline focus-visible:outline-accent"
          >
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-research-teal flex items-center justify-center glow-accent">
              <Cpu size={16} className="text-white" aria-hidden />
            </div>
            <div className="font-bold text-white text-sm leading-tight">ResearchOne</div>
          </Link>
        </div>

        <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
          {visibleNavItems.map(item => (
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
          <div className="text-sm text-slate-400">{activeNavItem?.desc ?? 'ResearchOne'}</div>
          <div className="flex items-center gap-3">
            <ActiveRunBadge />
            {/* Sign-out redirect is configured on <ClerkProvider afterSignOutUrl> (Clerk v6 no longer takes it on UserButton). */}
            <UserButton />
            {canViewSystemStatusDetails ? (
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
            ) : (
              <div className="flex items-center" aria-label="System status">
                <div
                  className={clsx(
                    'w-2 h-2 rounded-full',
                    healthFetching && 'animate-pulse',
                    overallColor
                  )}
                />
              </div>
            )}
          </div>
        </header>

        <main className="flex-1 overflow-y-auto grid-bg">
          <NotificationBanner />
          <PlanReviewBanner runs={allRuns ?? EMPTY_RESEARCH_RUNS} />
          <Outlet />
        </main>
      </div>

      {canViewSystemStatusDetails && (
        <SystemStatusModal
          open={healthOpen}
          onClose={() => setHealthOpen(false)}
          health={health}
          healthLoading={healthPending}
          healthError={healthIsError ? (healthError instanceof Error ? healthError : new Error(String(healthError))) : null}
          onRefreshHealth={refreshHealth}
          onRestart={handleRestart}
          restartBusy={restartBusy}
          isAllowlistedAdmin={isAllowlistedAdmin}
          breakGlassAdminToken={breakGlassToken}
          onBreakGlassAdminTokenChange={() => setBreakGlassToken(readBreakGlassAdminTokenFromSession())}
        />
      )}

      <Notifications />
    </div>
    </BugNoteProvider>
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
