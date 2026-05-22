import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import clsx from 'clsx';
import ResearchStandardPage from './ResearchStandardPage';
import ResearchDeepPage from './ResearchDeepPage';
import { DEEP_RESEARCH_ENGINE_QUERY, isDeepResearchFromSearchParams } from '../utils/researchRunRoutes';

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

  return (
    <div className="space-y-0">
      <div className="mx-auto max-w-5xl px-6 pt-8">
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
  );
}
