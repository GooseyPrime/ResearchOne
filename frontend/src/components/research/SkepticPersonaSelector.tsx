import { useState } from 'react';
import { ChevronDown, UserX } from 'lucide-react';
import clsx from 'clsx';

export const SKEPTIC_PERSONA_OPTIONS = [
  { id: 'fda', label: 'FDA Compliance Officer', description: 'Regulatory scrutiny focus' },
  { id: 'peer', label: 'Hostile Peer Reviewer', description: 'Academic rigor challenge' },
  { id: 'defense', label: 'Defense Attorney', description: 'Adversarial cross-examination' },
  { id: 'investor', label: 'Skeptical Investor', description: 'Due diligence perspective' },
  { id: 'journalist', label: 'Investigative Journalist', description: 'Source verification focus' },
  { id: 'custom', label: 'Custom Persona', description: 'Define your own adversary' },
] as const;

type SkepticPersonaSelectorProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Optional adversarial persona hint sent as `supplemental` on Deep (V2) submits.
 * Backend applies V2 red-team prompts via engineVersion + skeptic role — not a separate API field.
 */
export default function SkepticPersonaSelector({
  value,
  onChange,
  disabled = false,
  className,
}: SkepticPersonaSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className={clsx('relative', className)}>
      <label className="section-title block mb-2">Adversarial persona (optional)</label>
      <p className="text-xs text-slate-500 mb-2">
        Steers the skeptic / red-team pass. Sent as supplemental context for this run only.
      </p>
      <button
        type="button"
        disabled={disabled}
        className={clsx(
          'w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border text-sm text-left transition-colors',
          disabled
            ? 'border-surface-400/40 bg-surface-200/20 text-slate-500 cursor-not-allowed'
            : 'border-surface-400/80 bg-surface-200/40 hover:border-accent/40'
        )}
        onClick={() => !disabled && setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className="flex items-center gap-2 min-w-0">
          <UserX className="w-4 h-4 shrink-0 text-slate-400" />
          <span className={value ? 'text-slate-200 truncate' : 'text-slate-500 truncate'}>
            {value || 'Select adversarial persona (optional)'}
          </span>
        </span>
        <ChevronDown className={clsx('w-4 h-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && !disabled ? (
        <ul
          className="absolute z-20 mt-1 w-full rounded-lg border border-surface-400/80 bg-surface-100 shadow-xl max-h-64 overflow-y-auto"
          role="listbox"
        >
          {SKEPTIC_PERSONA_OPTIONS.map((persona) => (
            <li key={persona.id}>
              <button
                type="button"
                role="option"
                aria-selected={value === persona.label}
                className={clsx(
                  'w-full px-3 py-2.5 text-left text-sm hover:bg-accent/10 transition-colors',
                  value === persona.label && 'bg-accent/15'
                )}
                onClick={() => {
                  onChange(persona.id === 'custom' ? '' : persona.label);
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-200">{persona.label}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{persona.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
