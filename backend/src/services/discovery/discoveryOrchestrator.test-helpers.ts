/**
 * Test helpers that expose internal discovery logic for unit testing.
 * These are imported by __tests__/discovery.test.ts only.
 * Not imported by production code.
 */

import { SearchResultCandidate } from './providerTypes';

/** Normalise a URL for deduplication (same logic as discoveryOrchestrator.ts) */
export function normalizeUrl(raw: string): string {
  try {
    const u = new URL(raw);
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return raw.toLowerCase().trim();
  }
}

/** Deduplicate candidates by normalised URL — first occurrence wins */
export function dedupeByUrl(candidates: SearchResultCandidate[]): SearchResultCandidate[] {
  const seen = new Set<string>();
  const result: SearchResultCandidate[] = [];
  for (const c of candidates) {
    const key = normalizeUrl(c.url);
    if (!seen.has(key)) {
      seen.add(key);
      result.push(c);
    }
  }
  return result;
}

/** Select top N candidates sorted by score desc */
export function selectTopN(candidates: SearchResultCandidate[], n: number): SearchResultCandidate[] {
  return [...candidates]
    .sort((a, b) => b.score - a.score || a.rank - b.rank)
    .slice(0, n);
}
