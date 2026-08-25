import { describe, expect, it } from 'vitest';
import {
  buildAddonsSearchParam,
  filterAddonsToCatalogKeys,
  parseAddonsFromSearchParam,
  RESEARCH_RUN_ADDON_CATALOG_KEYS,
} from './researchRunAddons';

describe('researchRunAddons', () => {
  it('parses comma-separated addons from query param', () => {
    expect(parseAddonsFromSearchParam('smart_citations,parallel_search')).toEqual([
      'smart_citations',
      'parallel_search',
    ]);
  });

  it('ignores unknown keys', () => {
    expect(parseAddonsFromSearchParam('smart_citations,living_reports')).toEqual([
      'smart_citations',
    ]);
  });

  it('buildAddonsSearchParam round-trips known keys', () => {
    const param = buildAddonsSearchParam(['parallel_extract', 'smart_citations']);
    expect(param).toBe('parallel_extract,smart_citations');
    expect(parseAddonsFromSearchParam(param)).toEqual(['parallel_extract', 'smart_citations']);
  });

  it('filterAddonsToCatalogKeys respects catalog set', () => {
    expect(
      filterAddonsToCatalogKeys(['parallel_search', 'nope'], RESEARCH_RUN_ADDON_CATALOG_KEYS),
    ).toEqual(['parallel_search']);
  });

  it('drops the removed Devil\u2019s Advocate key from an old deep link (WO-AH)', () => {
    // Add-ons pages and emails may still carry `?addons=adversarial_twin`.
    expect(parseAddonsFromSearchParam('adversarial_twin')).toEqual([]);
    expect(parseAddonsFromSearchParam('adversarial_twin,parallel_search')).toEqual([
      'parallel_search',
    ]);
  });
});
