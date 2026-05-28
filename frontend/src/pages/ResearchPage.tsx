/**
 * ResearchPage — unified research console with deep links for plan review and run attach.
 */

import { useCallback } from 'react';
import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import ResearchStandardPage from './ResearchStandardPage';
import ResearchDeepPage from './ResearchDeepPage';
import UnifiedResearchConsole, {
  applyResearchModeToSearchParams,
  researchModeFromSearchParams,
  syncEngineQueryParam,
  type ResearchEngineMode,
} from './UnifiedResearchConsole';
import {
  isDeepResearchFromSearchParams,
  parseRunIdFromSearchParams,
} from '../utils/researchRunRoutes';

export default function ResearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const runId = parseRunIdFromSearchParams(searchParams);
  const focusPlan = location.hash === '#plan';

  const setMode = useCallback(
    (next: ResearchEngineMode) => {
      setSearchParams((prev) => applyResearchModeToSearchParams(prev, next), { replace: true });
    },
    [setSearchParams]
  );

  const syncEngineForRun = useCallback(
    (engineVersion?: string | null) => {
      const nextParams = syncEngineQueryParam(searchParams, engineVersion);
      if (!nextParams) return;
      setSearchParams(nextParams, { replace: true });
    },
    [searchParams, setSearchParams]
  );

  if (runId && focusPlan) {
    return isDeepResearchFromSearchParams(searchParams) ? (
      <ResearchDeepPage />
    ) : (
      <ResearchStandardPage />
    );
  }

  if (runId) {
    return <Navigate to={`/app/run/${runId}`} replace />;
  }

  return (
    <UnifiedResearchConsole
      initialMode={researchModeFromSearchParams(searchParams)}
      onModeChange={setMode}
      syncEngineForRun={syncEngineForRun}
    />
  );
}
