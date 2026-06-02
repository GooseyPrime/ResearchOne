import { URL } from 'url';

/** Normalise a URL for deduplication (remove fragment, trailing slash). */
export function normalizeCrawlUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw.toLowerCase().trim();
  }
}

const SKIP_EXTENSIONS = /\.(pdf|zip|gz|tar|tgz|png|jpe?g|gif|webp|svg|ico|mp3|mp4|webm|avi|mov|woff2?|ttf|eot|css|js)(\?|#|$)/i;

/** Resolve href against pageUrl; keep http(s) links on the same host as the seed. */
export function resolveSameOriginLink(href: string, pageUrl: string, seedHost: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) {
    return null;
  }
  const lowered = trimmed.toLowerCase();
  if (lowered.startsWith('javascript:') || lowered.startsWith('data:')) return null;

  try {
    const resolved = new URL(trimmed, pageUrl);
    if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') return null;
    if (resolved.hostname.toLowerCase() !== seedHost) return null;
    if (SKIP_EXTENSIONS.test(resolved.pathname)) return null;
    resolved.hash = '';
    return resolved.toString();
  } catch {
    return null;
  }
}

/** Extract same-origin links from raw HTML (used during BFS discovery). */
export function extractSameOriginLinks(html: string, pageUrl: string, seedHost: string): string[] {
  const found = new Set<string>();
  const re = /<a\b[^>]*\shref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const href = match[1] ?? match[2] ?? match[3];
    if (!href) continue;
    const resolved = resolveSameOriginLink(href, pageUrl, seedHost);
    if (resolved) found.add(normalizeCrawlUrl(resolved));
  }
  return [...found];
}

export interface DiscoverSiteCrawlOptions {
  seedUrl: string;
  /** Total layers to ingest: 1 = seed only, 2 = seed + pages it links to, etc. */
  crawlLayers: number;
  maxPages: number;
  fetchHtml: (url: string) => Promise<string>;
}

/**
 * BFS same-origin URL discovery. Layer 1 is the seed URL; each additional layer
 * follows links found on pages at the previous layer.
 */
export async function discoverSiteCrawlUrls(options: DiscoverSiteCrawlOptions): Promise<string[]> {
  const { seedUrl, crawlLayers, maxPages, fetchHtml } = options;
  const seed = normalizeCrawlUrl(seedUrl);
  let seedHost: string;
  try {
    seedHost = new URL(seed).hostname.toLowerCase();
  } catch {
    return [seed];
  }

  const layers = Math.max(1, Math.floor(crawlLayers));
  const cap = Math.max(1, Math.floor(maxPages));
  const visited = new Set<string>();
  const ordered: string[] = [];
  let frontier: string[] = [seed];

  for (let layer = 0; layer < layers && frontier.length > 0 && ordered.length < cap; layer++) {
    const nextFrontier: string[] = [];
    for (const pageUrl of frontier) {
      if (ordered.length >= cap) break;
      const key = normalizeCrawlUrl(pageUrl);
      if (visited.has(key)) continue;
      visited.add(key);
      ordered.push(key);

      if (layer >= layers - 1) continue;

      let html = '';
      try {
        html = await fetchHtml(key);
      } catch {
        continue;
      }
      const links = extractSameOriginLinks(html, key, seedHost);
      for (const link of links) {
        if (!visited.has(link) && ordered.length + nextFrontier.length < cap) {
          nextFrontier.push(link);
        }
      }
    }
    frontier = nextFrontier;
  }

  return ordered;
}

export function clampCrawlLayers(raw: unknown, maxLayers: number): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10);
  if (!Number.isFinite(n) || n < 1) return null;
  return Math.min(Math.floor(n), maxLayers);
}
