/**
 * Route-aware document `<title>` and link-preview meta tags for marketing routes.
 * Used at runtime (CSR) and captured into prerendered HTML by Playwright.
 *
 * Does not touch research prompts, PolicyOne strings, or V2 inference — presentation only.
 */

export type MarketingHeadEntry = {
  title: string;
  description: string;
  ogTitle: string;
};

const DEFAULT: MarketingHeadEntry = {
  title: 'ResearchOne',
  description:
    'ResearchOne — deep research that adapts to the question. Plan-first workflows, specialist analysis, and cited reports with uncertainty and contradictions made visible.',
  ogTitle: 'ResearchOne — Adaptive Deep Research Platform',
};

const BY_PATH: Record<string, MarketingHeadEntry> = {
  '/': DEFAULT,
  '/pricing': {
    title: 'Pricing — ResearchOne',
    description: 'Pricing that scales with how seriously you are researching — ResearchOne.',
    ogTitle: 'Pricing — ResearchOne',
  },
  '/methodology': {
    title: 'Methodology — ResearchOne',
    description:
      'How ResearchOne plans, reads sources, applies specialist analysis, and verifies findings based on your research objective.',
    ogTitle: 'Methodology — ResearchOne',
  },
  '/guide': {
    title: 'Guide — ResearchOne',
    description:
      'Task-focused guidance for asking better questions, reviewing research plans, and interpreting cited reports.',
    ogTitle: 'Guide — ResearchOne',
  },
  '/faq': {
    title: 'FAQ — ResearchOne',
    description: 'Frequently asked questions about ResearchOne, billing, security, and research modes.',
    ogTitle: 'FAQ — ResearchOne',
  },
  '/compare': {
    title: 'Compare — ResearchOne',
    description: 'Compare ResearchOne to other research and deep-research tools.',
    ogTitle: 'Compare — ResearchOne',
  },
  '/about': {
    title: 'About — ResearchOne',
    description: 'About ResearchOne — mission, team, and contact.',
    ogTitle: 'About — ResearchOne',
  },
  '/contact': {
    title: 'Contact — ResearchOne',
    description: 'Contact ResearchOne for sales, support, and partnerships.',
    ogTitle: 'Contact — ResearchOne',
  },
  '/docs': {
    title: 'Docs — ResearchOne',
    description: 'Product documentation and reference for ResearchOne.',
    ogTitle: 'Docs — ResearchOne',
  },
  '/changelog': {
    title: 'Changelog — ResearchOne',
    description: 'Release notes and product changelog for ResearchOne.',
    ogTitle: 'Changelog — ResearchOne',
  },
  '/security': {
    title: 'Security — ResearchOne',
    description: 'Security practices, data handling, and trust posture for ResearchOne.',
    ogTitle: 'Security — ResearchOne',
  },
  '/sovereign': {
    title: 'Sovereign — ResearchOne',
    description: 'Sovereign deployment and data residency options for ResearchOne.',
    ogTitle: 'Sovereign — ResearchOne',
  },
  '/byok': {
    title: 'BYOK — ResearchOne',
    description: 'Bring your own API keys and model routing with ResearchOne.',
    ogTitle: 'BYOK — ResearchOne',
  },
  '/terms': {
    title: 'Terms of Service — ResearchOne',
    description: 'ResearchOne terms of service.',
    ogTitle: 'Terms of Service — ResearchOne',
  },
  '/privacy': {
    title: 'Privacy Policy — ResearchOne',
    description: 'ResearchOne privacy policy.',
    ogTitle: 'Privacy Policy — ResearchOne',
  },
  '/acceptable-use': {
    title: 'Acceptable Use — ResearchOne',
    description: 'ResearchOne acceptable use policy.',
    ogTitle: 'Acceptable Use — ResearchOne',
  },
  '/sample-report': {
    title: 'Sample report — ResearchOne',
    description: 'Open a sample ResearchOne report with citations and methodology.',
    ogTitle: 'Sample report — ResearchOne',
  },
  '/sign-in': {
    title: 'Sign in — ResearchOne',
    description: 'Sign in to ResearchOne.',
    ogTitle: 'Sign in — ResearchOne',
  },
  '/sign-up': {
    title: 'Sign up — ResearchOne',
    description: 'Create a ResearchOne account.',
    ogTitle: 'Sign up — ResearchOne',
  },
};

const CANONICAL_ORIGIN = 'https://researchone.io';

export function resolveMarketingHead(pathname: string): MarketingHeadEntry {
  const normalized = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  return BY_PATH[normalized] ?? DEFAULT;
}

function upsertMeta<T extends HTMLElement>(selector: string, create: () => T): T {
  const existing = document.querySelector(selector);
  if (existing) return existing as T;
  const el = create();
  document.head.appendChild(el);
  return el;
}

/**
 * Applies title, description, canonical, Open Graph, and Twitter tags for `pathname`.
 * Safe to call on every client navigation; no-op when `document` is undefined.
 */
export function applyMarketingDocumentHead(pathname: string): void {
  if (typeof document === 'undefined') return;

  const { title, description, ogTitle } = resolveMarketingHead(pathname);
  const url = `${CANONICAL_ORIGIN}${pathname === '/' ? '' : pathname}`;

  document.title = title;

  const metaDesc = upsertMeta('meta[name="description"]', () => {
    const m = document.createElement('meta');
    m.setAttribute('name', 'description');
    return m;
  }) as HTMLMetaElement;
  metaDesc.setAttribute('content', description);

  const setOg = (property: string, content: string) => {
    const el = upsertMeta(`meta[property="${property}"]`, () => {
      const m = document.createElement('meta');
      m.setAttribute('property', property);
      return m;
    }) as HTMLMetaElement;
    el.setAttribute('content', content);
  };

  setOg('og:type', 'website');
  setOg('og:url', url);
  setOg('og:title', ogTitle);
  setOg('og:description', description);
  setOg('og:image', `${CANONICAL_ORIGIN}/og-image.svg`);
  setOg('og:site_name', 'ResearchOne');

  const setTw = (name: string, content: string) => {
    const el = upsertMeta(`meta[name="${name}"]`, () => {
      const m = document.createElement('meta');
      m.setAttribute('name', name);
      return m;
    }) as HTMLMetaElement;
    el.setAttribute('content', content);
  };

  setTw('twitter:card', 'summary_large_image');
  setTw('twitter:title', ogTitle);
  setTw('twitter:description', description);
  setTw('twitter:image', `${CANONICAL_ORIGIN}/og-image.svg`);

  const canonical = upsertMeta('link[rel="canonical"]', () => {
    const l = document.createElement('link');
    l.setAttribute('rel', 'canonical');
    return l;
  }) as HTMLLinkElement;
  canonical.setAttribute('href', url);
}
