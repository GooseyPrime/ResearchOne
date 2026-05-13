import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { applyMarketingDocumentHead } from '@/lib/marketingDocumentHead';

const APP_AREA_PREFIXES = ['/app', '/account', '/onboarding'];

function isAppShellPath(pathname: string) {
  return APP_AREA_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Keeps `<title>` and link-preview meta tags aligned with the current marketing route.
 * Per product request this uses `useEffect` (post-paint); prerender still captures final head after tick.
 * Authenticated app shells (`/app/*`, `/account/*`, `/onboarding`) are left unchanged except a generic title reset.
 */
export default function MarketingDocumentEffect() {
  const { pathname } = useLocation();

  useEffect(() => {
    if (isAppShellPath(pathname)) {
      document.title = 'ResearchOne';
      return;
    }
    applyMarketingDocumentHead(pathname);
  }, [pathname]);

  return null;
}
