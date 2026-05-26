import { useCallback, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FlaskConical } from 'lucide-react';
import clsx from 'clsx';
import ResearchStandardPage from './ResearchStandardPage';
import ResearchDeepPage from './ResearchDeepPage';
import { ResearchPageShellProvider } from './ResearchPageContext';
import {
  DEEP_RESEARCH_ENGINE_QUERY,
  isDeepResearchEngine,
  isDeepResearchFromSearchParams,
} from '../utils/researchRunRoutes';

type ResearchMode = 'standard' | 'deep';

export default function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const mode: ResearchMode = isDeepResearchFromSearchParams(searchParams) ? 'deep' : 'standard';

  const setMode = useCallback(
    (next: ResearchMode) => {
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (next === 'deep') {
            nextParams.set('engine', DEEP_RESEARCH_ENGINE_QUERY);
          } else {
            nextParams.delete('engine');
          }
          return nextParams;
        },
        { replace: true }
      );
    },
    [setSearchParams]
  );

  const syncEngineForRun = useCallback(
    (engineVersion?: string | null) => {
      const wantDeep = isDeepResearchEngine(engineVersion);
      const haveDeep = isDeepResearchFromSearchParams(searchParams);
      if (wantDeep === haveDeep) return;
      setSearchParams(
        (prev) => {
          const nextParams = new URLSearchParams(prev);
          if (wantDeep) {
            nextParams.set('engine', DEEP_RESEARCH_ENGINE_QUERY);
          } else {
            nextParams.delete('engine');
          }
          return nextParams;
        },
        { replace: true }
      );
    },
    [searchParams, setSearchParams]
  );

  const shellValue = useMemo(
    () => ({ embeddedInShell: true, syncEngineForRun }),
    [syncEngineForRun]
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
              {mode === 'deep'
                ? 'Multi-model Deep Research with plan review, live trace, and ensemble reporting.'
                : 'Standard research with source-corroboration-tiered reporting and full-stage telemetry.'}{' '}
              <Link
                to="/app/guide/research-v2"
                className="text-accent hover:underline"
              >
                Research modes and capabilities
              </Link>
            </p>
          </div>

          <div
            className="inline-flex rounded-lg border border-surface-400/80 bg-surface-200/40 p-1"
            role="tablist"
            aria-label="Research mode"
          >
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'standard'}
              className={clsx(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === 'standard'
                  ? 'bg-accent/20 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
              onClick={() => setMode('standard')}
            >
              Standard
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'deep'}
              className={clsx(
                'rounded-md px-4 py-2 text-sm font-medium transition-colors',
                mode === 'deep'
                  ? 'bg-accent/20 text-white shadow-sm'
                  : 'text-slate-400 hover:text-slate-200'
              )}
              onClick={() => setMode('deep')}
            >
              Deep Research
            </button>
          </div>
        </div>

        {mode === 'deep' ? <ResearchDeepPage /> : <ResearchStandardPage />}
      </div>
    </ResearchPageShellProvider>
  );
}
