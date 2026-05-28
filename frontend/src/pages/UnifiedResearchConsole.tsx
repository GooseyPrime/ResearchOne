import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ResearchRun } from '../utils/api';
import { Link } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import clsx from 'clsx';
import ResearchStandardPage from './ResearchStandardPage';
import ResearchDeepPage from './ResearchDeepPage';
import { ResearchPageShellProvider } from './ResearchPageContext';
import ResearchEngineModeToggle, { type ResearchEngineMode } from '../components/research/ResearchEngineModeToggle';
import DeepResearchUpgradeModal from '../components/research/DeepResearchUpgradeModal';
import { useCanAccessDeepResearch } from '../hooks/useCanAccessDeepResearch';
import {
  DEEP_RESEARCH_ENGINE_QUERY,
  isDeepResearchEngine,
  isDeepResearchFromSearchParams,
} from '../utils/researchRunRoutes';

type UnifiedResearchConsoleProps = {
  initialMode: ResearchEngineMode;
  onModeChange: (next: ResearchEngineMode) => void;
  syncEngineForRun: (engineVersion?: string | null) => void;
};

/**
 * Unified `/app/research` console: mode toggle + full Standard/Deep pages (inline trace/plan).
 * Remounting children on mode change clears Deep-only form state (files, objective, persona).
 */
export default function UnifiedResearchConsole({
  initialMode,
  onModeChange,
  syncEngineForRun,
}: UnifiedResearchConsoleProps) {
  const [mode, setMode] = useState<ResearchEngineMode>(initialMode);
  const [showDeepUpgrade, setShowDeepUpgrade] = useState(false);
  const pendingRunHandoffRef = useRef<ResearchRun | null>(null);
  const { canAccessDeep, tierGateUnknown } = useCanAccessDeepResearch();

  const queueRunHandoff = useCallback((run: ResearchRun) => {
    pendingRunHandoffRef.current = run;
  }, []);

  const consumeRunHandoff = useCallback((): ResearchRun | null => {
    const run = pendingRunHandoffRef.current;
    pendingRunHandoffRef.current = null;
    return run;
  }, []);

  useEffect(() => {
    setMode(initialMode);
  }, [initialMode]);

  useEffect(() => {
    if (tierGateUnknown || canAccessDeep || mode !== 'deep') return;
    setShowDeepUpgrade(true);
    setMode('standard');
    onModeChange('standard');
  }, [canAccessDeep, mode, onModeChange, tierGateUnknown]);

  const handleModeChange = useCallback(
    (next: ResearchEngineMode) => {
      if (next === 'deep' && !tierGateUnknown && !canAccessDeep) {
        setShowDeepUpgrade(true);
        return;
      }
      setMode(next);
      onModeChange(next);
    },
    [canAccessDeep, onModeChange, tierGateUnknown]
  );

  const shellValue = useMemo(
    () => ({
      embeddedInShell: true,
      shellMode: mode,
      syncEngineForRun,
      queueRunHandoff,
      consumeRunHandoff,
    }),
    [mode, syncEngineForRun, queueRunHandoff, consumeRunHandoff]
  );

  return (
    <ResearchPageShellProvider value={shellValue}>
      <div
        className={clsx(
          'mx-auto px-6 py-8 space-y-6',
          mode === 'deep' ? 'max-w-[1500px]' : 'max-w-5xl'
        )}
      >
        <div className="space-y-4">
          <div>
            <h1 className="text-3xl font-bold text-white flex items-center gap-3">
              <FlaskConical className="text-accent" size={28} />
              <span className="text-gradient">Research</span>
            </h1>
            <p className="text-slate-400 mt-2 text-sm">
              Choose a research method, submit from this page, and track progress inline — including plan
              review when the pipeline pauses.{' '}
              <Link to="/app/guide/research-v2" className="text-accent hover:underline">
                Research modes and capabilities
              </Link>
            </p>
          </div>

          <ResearchEngineModeToggle
            mode={mode}
            onModeChange={handleModeChange}
            deepLocked={!tierGateUnknown && !canAccessDeep}
          />
        </div>

        {mode === 'deep' ? (
          <ResearchDeepPage key="research-deep-console" />
        ) : (
          <ResearchStandardPage key="research-standard-console" />
        )}
      </div>

      {showDeepUpgrade ? <DeepResearchUpgradeModal onClose={() => setShowDeepUpgrade(false)} /> : null}
    </ResearchPageShellProvider>
  );
}

export type { ResearchEngineMode };

export function researchModeFromSearchParams(searchParams: URLSearchParams): ResearchEngineMode {
  return isDeepResearchFromSearchParams(searchParams) ? 'deep' : 'standard';
}

export function applyResearchModeToSearchParams(
  prev: URLSearchParams,
  next: ResearchEngineMode
): URLSearchParams {
  const nextParams = new URLSearchParams(prev);
  if (next === 'deep') {
    nextParams.set('engine', DEEP_RESEARCH_ENGINE_QUERY);
  } else {
    nextParams.delete('engine');
  }
  return nextParams;
}

export function syncEngineQueryParam(
  searchParams: URLSearchParams,
  engineVersion?: string | null
): URLSearchParams | null {
  const wantDeep = isDeepResearchEngine(engineVersion);
  const haveDeep = isDeepResearchFromSearchParams(searchParams);
  if (wantDeep === haveDeep) return null;
  return applyResearchModeToSearchParams(searchParams, wantDeep ? 'deep' : 'standard');
}
