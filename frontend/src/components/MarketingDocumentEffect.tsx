import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyMarketingDocumentHead } from '@/lib/marketingDocumentHead';
import { applyAnalyticsScope, isSignedInAreaPath } from '@/lib/analyticsScope';
import { flushQueuedAnalyticsEvents } from '@/lib/analyticsEvents';

/**
 * Keeps `<title>` and link-preview meta tags aligned with the current marketing route.
 * Per product request this uses `useEffect` (post-paint); prerender still captures final head after tick.
 * Authenticated app shells (`/app/*`, `/account/*`, `/onboarding`) are left unchanged except a generic title reset.
 *
 * It also keeps the analytics tag off the private signed-in pages (RJ-022,
 * RJ-023). The page's own script (`index.html`) sets that switch the moment
 * the address changes; this sets it again while rendering, for anything that
 * reaches a route without going through the browser's history. On a page the
 * tag may count, events held back on a private page are then sent.
 */
export default function MarketingDocumentEffect() {
  const { pathname } = useLocation();
  applyAnalyticsScope(pathname);

  useEffect(() => {
    flushQueuedAnalyticsEvents(pathname);
    if (isSignedInAreaPath(pathname)) {
      document.title = 'ResearchOne';
      return;
    }
    applyMarketingDocumentHead(pathname);
  }, [pathname]);

  return null;
}
