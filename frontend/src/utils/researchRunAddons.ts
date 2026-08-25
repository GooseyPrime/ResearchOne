/** Comma-separated keys in `/app/research?addons=` deep links from Add-ons page. */
export const RESEARCH_ADDONS_QUERY_KEY = 'addons';

export const RESEARCH_RUN_ADDON_CATALOG_KEYS = new Set([
  'parallel_search',
  'parallel_extract',
  'smart_citations',
]);

const KNOWN_RUN_ADDON_KEYS = RESEARCH_RUN_ADDON_CATALOG_KEYS;

export function parseAddonsFromSearchParam(raw: string | null | undefined): string[] {
  if (!raw?.trim()) return [];
  const out: string[] = [];
  for (const part of raw.split(',')) {
    const key = part.trim();
    if (!key || !KNOWN_RUN_ADDON_KEYS.has(key) || out.includes(key)) continue;
    out.push(key);
  }
  return out;
}

export function buildAddonsSearchParam(selected: readonly string[]): string | null {
  const keys = selected.filter((k) => KNOWN_RUN_ADDON_KEYS.has(k));
  return keys.length > 0 ? keys.join(',') : null;
}

export function filterAddonsToCatalogKeys(
  keys: readonly string[],
  catalogRunAddonKeys: ReadonlySet<string>,
): string[] {
  return keys.filter((k) => catalogRunAddonKeys.has(k));
}
