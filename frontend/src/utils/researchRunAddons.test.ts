import { describe, expect, it } from 'vitest';
import {
  buildAddonsSearchParam,
  filterAddonsToCatalogKeys,
  parseAddonsFromSearchParam,
  RESEARCH_RUN_ADDON_CATALOG_KEYS,
} from './researchRunAddons';

describe('researchRunAddons', () => {
  it('parses comma-separated addons from query param', () => {
    expect(parseAddonsFromSearchParam('adversarial_twin,parallel_search')).toEqual([
      'adversarial_twin',
      'parallel_search',
    ]);
  });

  it('ignores unknown keys', () => {
    expect(parseAddonsFromSearchParam('adversarial_twin,living_reports')).toEqual([
      'adversarial_twin',
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
});
