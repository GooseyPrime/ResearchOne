/**
 * ResearchPage — Sticklight new-run console, with deep links for plan review.
 */

import { Navigate, useLocation, useSearchParams } from 'react-router-dom';
import { ResearchDashboard } from '@/components/r1-dashboard/ResearchDashboard';
import ResearchStandardPage from './ResearchStandardPage';
import ResearchDeepPage from './ResearchDeepPage';
import {
  isDeepResearchFromSearchParams,
  parseRunIdFromSearchParams,
} from '../utils/researchRunRoutes';

export default function ResearchPage() {
  const [searchParams] = useSearchParams();
  const location = useLocation();
  const runId = parseRunIdFromSearchParams(searchParams);
  const focusPlan = location.hash === '#plan';

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

  return <ResearchDashboard />;
}
