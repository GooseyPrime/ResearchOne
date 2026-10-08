/**
 * Gives a source its authority tier from the rules in `config/authorityTiers.ts`.
 * Deterministic: the same provider, kind and address always give the same tier.
 */
import { AUTHORITY_RULES, DEFAULT_AUTHORITY_TIER, type AuthorityRule, type AuthoritySignals, type AuthorityTier } from '../../config/authorityTiers';
import { switchEnabled } from '../../config/runFlags';

export type { AuthorityTier, AuthoritySignals };

/** Slice 6. Unset is off. */
export function authorityTiersEnabled(): boolean {
  return switchEnabled('AUTHORITY_TIERS_ENABLED');
}

interface Address {
  host: string;
  path: string;
}

function addressOf(url: string | null | undefined): Address | null {
  const text = (url ?? '').trim();
  if (!text) return null;
  try {
    const parsed = new URL(text);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    const host = parsed.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
    return host ? { host, path: parsed.pathname } : null;
  } catch {
    return null;
  }
}

/** `host` is `name` or a subdomain of it. "evil-nature.com" is not "nature.com". */
const isOrUnder = (host: string, name: string): boolean => host === name || host.endsWith(`.${name}`);

function matches(rule: AuthorityRule, kind: string, provider: string, address: Address | null): boolean {
  if (rule.kinds) return kind !== '' && rule.kinds.includes(kind);
  if (rule.providers) {
    if (provider === '' || !rule.providers.includes(provider)) return false;
    return rule.withoutKind ? kind === '' : true;
  }
  if (!address) return false;
  const onHost = (rule.hosts ?? []).some((name) => isOrUnder(address.host, name));
  // A suffix is whole labels: "nrc.gov" ends with "gov"; "gov.example.com" does not.
  // A suffix of more than one label is a site in its own right ("canada.ca",
  // "europa.eu"), so the bare name matches too. A bare top-level name ("gov") does not.
  const onSuffix = (rule.hostSuffixes ?? []).some((suffix) => address.host.endsWith(`.${suffix}`) || (suffix.includes('.') && address.host === suffix));
  if (!onHost && !onSuffix) return false;
  return rule.path ? rule.path.test(address.path) : true;
}

/** The first rule that recognises the source, or null when none does. */
export function authorityRuleFor(signals: AuthoritySignals): AuthorityRule | null {
  const kind = (signals.kind ?? '').trim().toLowerCase();
  const provider = (signals.provider ?? '').trim().toLowerCase();
  const address = addressOf(signals.url);
  return AUTHORITY_RULES.find((rule) => matches(rule, kind, provider, address)) ?? null;
}

/**
 * The tier of a source. A source with no web address, no provider and no
 * recorded kind (a file someone uploaded) has nothing to be judged by and gets
 * null, not the lowest tier: it is unranked, not ranked last on evidence.
 */
export function authorityTierFor(signals: AuthoritySignals): AuthorityTier | null {
  const rule = authorityRuleFor(signals);
  if (rule) return rule.tier;
  const known = addressOf(signals.url) || (signals.provider ?? '').trim() || (signals.kind ?? '').trim();
  return known ? DEFAULT_AUTHORITY_TIER : null;
}

/** What one discovery result says about a source: the provider that returned it and the kind it recorded. */
export interface DiscoveredSignals {
  provider?: string | null;
  url?: string | null;
  bibliographic?: { kind?: string | null; provider?: string | null } | null;
}

const signalsOf = (result: DiscoveredSignals): AuthoritySignals => ({
  kind: result.bibliographic?.kind,
  provider: result.bibliographic?.provider ?? result.provider,
  url: result.url,
});

/**
 * The tier of an address that one or more providers returned. Each provider's
 * record is read against the rules, and the record matched by the earliest rule
 * decides: rule order is precedence, so a record that says what the work is
 * outranks one that only names where it was found.
 */
export function authorityTierOfResults(results: readonly DiscoveredSignals[]): AuthorityTier | null {
  let best: { tier: AuthorityTier | null; at: number } | null = null;
  for (const result of results) {
    const signals = signalsOf(result);
    const rule = authorityRuleFor(signals);
    const at = rule ? AUTHORITY_RULES.indexOf(rule) : AUTHORITY_RULES.length;
    if (!best || at < best.at) best = { tier: authorityTierFor(signals), at };
  }
  return best?.tier ?? null;
}

/** A stored value read back: 1 to 4, or null for anything else. */
export function storedAuthorityTier(value: unknown): AuthorityTier | null {
  const n = typeof value === 'string' && /^[1-4]$/.test(value) ? Number(value) : value;
  return n === 1 || n === 2 || n === 3 || n === 4 ? n : null;
}

/** What is stored about a source, as read back when its passages are retrieved. */
export interface StoredSourceSignals {
  authority_tier?: unknown;
  url?: string | null;
}

/**
 * The tier of a stored source. The recorded tier when there is one: it was
 * worked out at ingest from signals that were trusted then. Otherwise the
 * source is judged by its address alone. The kind and provider kept under a
 * source's metadata are not used here: a later upload of the same content can
 * fill them in, and nothing records who supplied them.
 */
export function tierOfStoredSource(row: StoredSourceSignals): AuthorityTier | null {
  return storedAuthorityTier(row.authority_tier) ?? authorityTierFor({ url: row.url });
}

/**
 * What the writer is told about a source's standing, by tier: each covers its
 * whole group, so the writer is never told a source is a kind it is not. Tier 2
 * includes pages matched only by a journal publisher's host, which does not
 * establish peer review, so its words do not claim it.
 * Words for the writer, not labels for the reader.
 */
export const STANDING_FOR_WRITER: Readonly<Record<AuthorityTier, string>> = {
  1: 'an official or primary record',
  2: 'scholarly work from a journal or its publisher',
  3: 'published work not established as peer reviewed (such as a preprint, book, thesis, news report or reference work)',
  4: 'a source of unestablished standing',
};

/**
 * Two passages count as equally relevant when their scores agree to this many
 * decimal places. Retrieval scores are continuous, so exact ties almost never
 * happen; without a band the tier would never decide anything.
 */
export const RELEVANCE_BAND_DECIMALS = 2;

const band = (similarity: number): number => Math.round(similarity * 10 ** RELEVANCE_BAND_DECIMALS);
/** Unranked sources sort after tier 4 among equals, never before a ranked one. */
const rank = (tier: AuthorityTier | null | undefined): number => tier ?? 5;

/**
 * Relevance first, then tier: within one relevance band the higher tier comes
 * first, then the more relevant. Nothing is removed (invariant 7); a lower-tier
 * passage only gives way to an equally relevant higher-tier one.
 */
export function orderByRelevanceThenAuthority<T extends { similarity: number; authority_tier?: AuthorityTier | null }>(chunks: readonly T[]): T[] {
  return [...chunks].sort(
    (a, b) => band(b.similarity) - band(a.similarity) || rank(a.authority_tier) - rank(b.authority_tier) || b.similarity - a.similarity
  );
}
