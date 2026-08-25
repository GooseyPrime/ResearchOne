import { Navigate, useLocation } from 'react-router-dom';
import { RESEARCH_PAGE_PATH } from '../utils/researchRunRoutes';

/**
 * `/app/research-v2` was the Deep Research entry point. There is one research
 * page now and one engine behind it, so this keeps old links working and
 * carries any query string across unchanged.
 */
export default function ResearchLegacyV2Redirect() {
  const location = useLocation();
  const search = location.search ?? '';
  const hash = location.hash ?? '';
  return <Navigate to={`${RESEARCH_PAGE_PATH}${search}${hash}`} replace />;
}
