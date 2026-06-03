import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import type { AddonCatalogEntry } from '../../pages/AddOnsPage';

type RunAddonTogglesProps = {
  selected: string[];
  onToggle: (runAddonKey: string) => void;
  disabled?: boolean;
};

export default function RunAddonToggles({ selected, onToggle, disabled }: RunAddonTogglesProps) {
  const catalogQuery = useQuery({
    queryKey: ['billing-addon-catalog'],
    queryFn: async () => (await api.get<{ addons: AddonCatalogEntry[] }>('/billing/addon-catalog')).data,
    staleTime: 60_000,
  });

  const runAddons = (catalogQuery.data?.addons ?? []).filter(
    (a) => a.category === 'research_run' && a.runAddonKey && !a.comingSoon,
  );

  if (catalogQuery.isLoading) {
    return <p className="text-xs text-slate-500">Loading run add-ons…</p>;
  }

  if (catalogQuery.isError) {
    return (
      <p className="text-xs text-slate-500">
        Could not load add-on catalog.{' '}
        <Link to="/app/add-ons" className="text-indigo-400 hover:text-indigo-300">
          View add-ons
        </Link>
      </p>
    );
  }

  if (runAddons.length === 0) return null;

  return (
    <div className="space-y-2 rounded-md border border-white/10 bg-slate-900/40 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="section-title text-xs">Run enhancements</p>
        <Link to="/app/add-ons" className="text-[10px] text-indigo-400 hover:text-indigo-300 shrink-0">
          All add-ons
        </Link>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        Wallet surcharge at submit when your plan does not include the feature.
      </p>
      <ul className="space-y-2">
        {runAddons.map((addon) => {
          const key = addon.runAddonKey!;
          const checked = selected.includes(key);
          return (
            <li key={addon.id}>
              <label className="flex items-start gap-2 cursor-pointer text-xs text-slate-300">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={checked}
                  disabled={disabled}
                  onChange={() => onToggle(key)}
                />
                <span>
                  <span className="text-slate-200">{addon.name}</span>
                  <span className="text-slate-500"> · {addon.priceLabel}</span>
                  <span className="block text-slate-500 mt-0.5 leading-relaxed">{addon.description}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
