import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyMarketingDocumentHead } from '@/lib/marketingDocumentHead';
import { applyAnalyticsScope, isSignedInAreaPath } from '@/lib/analyticsScope';

/**
 * Keeps `<title>` and link-preview meta tags aligned with the current marketing route.
 * Per product request this uses `useEffect` (post-paint); prerender still captures final head after tick.
 * Authenticated app shells (`/app/*`, `/account/*`, `/onboarding`) are left unchanged except a generic title reset.
 *
 * It also keeps the analytics tag off the signed-in pages (RJ-022). That runs
 * while rendering, not in the effect: the tag reacts to the address changing,
 * which happens before effects run, so the switch has to be set by then.
 */
export default function MarketingDocumentEffect() {
  const { pathname } = useLocation();
  applyAnalyticsScope(pathname);

  useEffect(() => {
    if (isSignedInAreaPath(pathname)) {
      document.title = 'ResearchOne';
      return;
    }
    applyMarketingDocumentHead(pathname);
  }, [pathname]);

  return null;
}
