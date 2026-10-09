import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';
import type { AddonCatalogEntry } from '../../pages/AddOnsPage';
import { customerOption, customerOptionHelp, findCustomerOption } from '../../content/customerOptions';

const FIELD = customerOption('request_field', 'run_enhancements');

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

  // An add-on is offered only when the registry of customer-facing names has
  // its name, description and example; one it does not know is not shown.
  const runAddons = (catalogQuery.data?.addons ?? []).flatMap((a) => {
    const words = findCustomerOption('add_on', a.id);
    return a.category === 'research_run' && a.runAddonKey && !a.comingSoon && words ? [{ ...a, words }] : [];
  });

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
        <p className="section-title text-xs" title={FIELD.description}>{FIELD.name}</p>
        <Link to="/app/add-ons" className="text-[10px] text-indigo-400 hover:text-indigo-300 shrink-0">
          All add-ons
        </Link>
      </div>
      <p className="text-[10px] text-slate-500 leading-relaxed">
        {FIELD.description} The price shown is taken from your wallet when you submit, unless your plan already includes it.
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
                  <span className="text-slate-200">{addon.words.name}</span>
                  <span className="text-slate-500"> · {addon.priceLabel}</span>
                  <span className="block text-slate-500 mt-0.5 leading-relaxed">{customerOptionHelp(addon.words)}</span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
