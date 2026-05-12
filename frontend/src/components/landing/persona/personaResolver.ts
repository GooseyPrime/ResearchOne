/**
 * Persona resolver — deterministic, client-side, wire-silent.
 *
 * Reads URL search params, referrer, pathname, and a sessionStorage
 * cache to decide which buyer-tribe persona is most likely viewing
 * the current page.
 *
 * Per Cursor rule 26 I-1: this module makes NO network calls, reads
 * NO cookies, and does NOT fingerprint the client. It is intentionally
 * the smallest possible client-side router for inbound landing
 * traffic.
 *
 * Per Cursor rule 26 I-7: the resolver is deterministic. The same
 * (search, referrer, path) triple always yields the same persona id.
 *
 * Per Cursor rule 26 I-8: sessionStorage cache TTL = browser session.
 */

export const PERSONA_IDS = ['osint', 'uap', 'academic', 'patent', 'default'] as const;
export type PersonaId = typeof PERSONA_IDS[number];

export function isPersonaId(value: unknown): value is PersonaId {
  return typeof value === 'string' && (PERSONA_IDS as readonly string[]).includes(value);
}

const SESSION_STORAGE_KEY = 'r1.persona';

// ─── Resolution signals, in priority order ─────────────────────────

/**
 * Order matters. The first signal that resolves wins.
 *
 *   1. Explicit ?p=... query param (the strongest signal — operator
 *      put it there on purpose).
 *   2. utm_source/utm_campaign — typical paid acquisition source.
 *   3. Referrer host or path — organic traffic from a community.
 *   4. Pathname — persona-specific landing routes like /for/journalists.
 *   5. SessionStorage cache from an earlier resolve in this tab.
 *   6. Fallback to 'default'.
 */

// 1. Explicit query param.
function fromQueryParam(search: URLSearchParams): PersonaId | null {
  const p = search.get('p')?.toLowerCase().trim();
  if (p && isPersonaId(p)) return p;
  return null;
}

// 2. UTM.
function fromUtm(search: URLSearchParams): PersonaId | null {
  const source = search.get('utm_source')?.toLowerCase().trim();
  const campaign = search.get('utm_campaign')?.toLowerCase().trim();
  const haystack = `${source ?? ''}|${campaign ?? ''}`;

  if (/\b(osint|nicar|bellingcat|ire|journalism|journalist)\b/.test(haystack)) return 'osint';
  if (/\b(uap|ufo|paranormal|disclosure|highstrangeness)\b/.test(haystack) || haystack.includes('disclosure_uap')) return 'uap';
  if (/\b(academic|grad|gradschool|phd|elicit|consensus|scite|systematic)\b/.test(haystack)) return 'academic';
  if (/\b(patent|patsnap|patlytics|iplytics|deepip|prior[-_]?art)\b/.test(haystack)) return 'patent';
  return null;
}

// 3. Referrer. We match by host or distinctive subpath; never the full
//    referrer URL.
function fromReferrer(referrer: string): PersonaId | null {
  if (!referrer) return null;
  let host = '';
  let pathname = '';
  try {
    const url = new URL(referrer);
    host = url.host.toLowerCase();
    pathname = url.pathname.toLowerCase();
  } catch {
    return null; // malformed referrer — fall through silently
  }

  // OSINT communities / journalism orgs.
  if (
    /(^|\.)bellingcat\.com$/.test(host) ||
    /(^|\.)ire\.org$/.test(host) ||
    /(^|\.)niemanlab\.org$/.test(host) ||
    /(^|\.)cjr\.org$/.test(host) ||
    /\/r\/osint\b/.test(pathname) ||
    /\/r\/journalism\b/.test(pathname) ||
    /\/r\/datajournalism\b/.test(pathname)
  ) {
    return 'osint';
  }

  // UAP / paranormal disclosure communities.
  if (
    /\/r\/ufos\b/.test(pathname) ||
    /\/r\/uap\b/.test(pathname) ||
    /\/r\/highstrangeness\b/.test(pathname) ||
    /\/r\/aliens\b/.test(pathname)
  ) {
    return 'uap';
  }

  // Academic.
  if (
    /(^|\.)elicit\.com$/.test(host) ||
    /(^|\.)consensus\.app$/.test(host) ||
    /(^|\.)scite\.ai$/.test(host) ||
    /(^|\.)scholar\.google\./.test(host) ||
    /\/r\/askacademia\b/.test(pathname) ||
    /\/r\/phd\b/.test(pathname) ||
    /\/r\/gradschool\b/.test(pathname) ||
    /\/r\/labrats\b/.test(pathname)
  ) {
    return 'academic';
  }

  // Patent / IP.
  if (
    /(^|\.)patsnap\.com$/.test(host) ||
    /(^|\.)questel\.com$/.test(host) ||
    /(^|\.)lens\.org$/.test(host) ||
    /(^|\.)patents\.google\.com$/.test(host) ||
    /\/r\/patentlaw\b/.test(pathname)
  ) {
    return 'patent';
  }

  return null;
}

// 4. Path-based personas (when we expose persona-specific routes).
function fromPathname(pathname: string): PersonaId | null {
  const p = pathname.toLowerCase();
  if (p.startsWith('/for/journalists') || p.startsWith('/for/osint')) return 'osint';
  if (p.startsWith('/for/uap') || p.startsWith('/for/disclosure')) return 'uap';
  if (p.startsWith('/for/academic') || p.startsWith('/for/researchers')) return 'academic';
  if (p.startsWith('/for/patent') || p.startsWith('/for/ip')) return 'patent';
  return null;
}

// ─── Top-level resolver ────────────────────────────────────────────

export interface ResolveOptions {
  /** Override for the search string (default: window.location.search). */
  search?: string;
  /** Override for the referrer (default: document.referrer). */
  referrer?: string;
  /** Override for the pathname (default: window.location.pathname). */
  pathname?: string;
  /** Whether to consult sessionStorage. Default: true. Tests opt out. */
  useSessionCache?: boolean;
  /** Whether to write a successful resolution back to sessionStorage.
   *  Default: true. */
  writeSessionCache?: boolean;
}

/**
 * Resolve the current persona.
 *
 * SSR-safe: when `window` is undefined, returns `'default'` without
 * touching any global. Per rule 26 I-10, this is asserted in tests.
 */
export function resolvePersona(opts: ResolveOptions = {}): PersonaId {
  // SSR safety.
  if (typeof window === 'undefined') return 'default';

  const search = new URLSearchParams(opts.search ?? window.location.search);
  const referrer = opts.referrer ?? (typeof document !== 'undefined' ? document.referrer : '');
  const pathname = opts.pathname ?? window.location.pathname;
  const useSessionCache = opts.useSessionCache ?? true;
  const writeSessionCache = opts.writeSessionCache ?? true;

  // 1. Query param wins outright.
  const fromQ = fromQueryParam(search);
  if (fromQ) {
    persistToSession(fromQ, writeSessionCache);
    return fromQ;
  }

  // 2. UTM.
  const fromU = fromUtm(search);
  if (fromU) {
    persistToSession(fromU, writeSessionCache);
    return fromU;
  }

  // 3. Referrer.
  const fromR = fromReferrer(referrer);
  if (fromR) {
    persistToSession(fromR, writeSessionCache);
    return fromR;
  }

  // 4. Path.
  const fromP = fromPathname(pathname);
  if (fromP) {
    persistToSession(fromP, writeSessionCache);
    return fromP;
  }

  // 5. Session cache (from an earlier resolve in this tab).
  if (useSessionCache) {
    const cached = readFromSession();
    if (cached) return cached;
  }

  // 6. Fallback.
  return 'default';
}

function readFromSession(): PersonaId | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return isPersonaId(raw) ? raw : null;
  } catch {
    // sessionStorage can throw in private-browsing on some browsers.
    // Silent fallback is correct.
    return null;
  }
}

function persistToSession(persona: PersonaId, enabled: boolean): void {
  if (!enabled) return;
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.setItem(SESSION_STORAGE_KEY, persona);
  } catch {
    // Same private-browsing tolerance.
  }
}

/**
 * Test/admin helper — clears the cached persona. Not exported from
 * the barrel.
 */
export function _clearPersonaCache(): void {
  try {
    if (typeof sessionStorage === 'undefined') return;
    sessionStorage.removeItem(SESSION_STORAGE_KEY);
  } catch { /* silent */ }
}
