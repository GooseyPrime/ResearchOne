import { Navigate, useLocation } from 'react-router-dom';
import { DEEP_RESEARCH_ENGINE_QUERY, RESEARCH_PAGE_PATH } from '../utils/researchRunRoutes';

/** Legacy `/app/research-v2` → unified `/app/research?engine=v2` (preserves runId, hash, other params). */
export default function ResearchLegacyV2Redirect() {
  const location = useLocation();
  const params = new URLSearchParams(location.search);
  if (!params.has('engine')) {
    params.set('engine', DEEP_RESEARCH_ENGINE_QUERY);
  }
  const search = params.toString();
  return (
    <Navigate
      to={{ pathname: RESEARCH_PAGE_PATH, search: search ? `?${search}` : '', hash: location.hash }}
      replace
    />
  );
}
