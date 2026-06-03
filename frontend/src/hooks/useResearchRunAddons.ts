import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  buildAddonsSearchParam,
  filterAddonsToCatalogKeys,
  parseAddonsFromSearchParam,
  RESEARCH_ADDONS_QUERY_KEY,
} from '../utils/researchRunAddons';

/**
 * Selected per-run add-ons for research submit forms.
 * Hydrates from `?addons=` once per mount (Add-ons page deep link).
 */
export function useResearchRunAddons(catalogRunAddonKeys: ReadonlySet<string>) {
  const [searchParams, setSearchParams] = useSearchParams();
  const hydratedRef = useRef(false);
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    if (hydratedRef.current || catalogRunAddonKeys.size === 0) return;
    const fromUrl = filterAddonsToCatalogKeys(
      parseAddonsFromSearchParam(searchParams.get(RESEARCH_ADDONS_QUERY_KEY)),
      catalogRunAddonKeys,
    );
    if (fromUrl.length > 0) {
      setSelected(fromUrl);
    }
    hydratedRef.current = true;
  }, [catalogRunAddonKeys, searchParams]);

  const toggleAddon = useCallback((key: string) => {
    setSelected((prev) => (prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]));
  }, []);

  const selectedForSubmit = useMemo(
    () => filterAddonsToCatalogKeys(selected, catalogRunAddonKeys),
    [catalogRunAddonKeys, selected],
  );

  const syncAddonsToUrl = useCallback(() => {
    const next = buildAddonsSearchParam(selectedForSubmit);
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next) params.set(RESEARCH_ADDONS_QUERY_KEY, next);
        else params.delete(RESEARCH_ADDONS_QUERY_KEY);
        return params;
      },
      { replace: true },
    );
  }, [selectedForSubmit, setSearchParams]);

  return {
    selectedAddons: selected,
    selectedAddonsForSubmit: selectedForSubmit,
    toggleAddon,
    setSelectedAddons: setSelected,
    syncAddonsToUrl,
  };
}
