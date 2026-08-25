import { useEffect, useState } from 'react';
import { ChevronDown, UserX } from 'lucide-react';
import clsx from 'clsx';
import {
  isPresetSkepticPersonaLabel,
  SKEPTIC_PERSONA_OPTIONS,
} from '../../utils/skepticPersonaSupplemental';

export { SKEPTIC_PERSONA_OPTIONS };

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
  const [customActive, setCustomActive] = useState(
    () => Boolean(value.trim()) && !isPresetSkepticPersonaLabel(value)
  );

  useEffect(() => {
    if (!value.trim()) {
      setCustomActive(false);
      return;
    }
    if (isPresetSkepticPersonaLabel(value)) {
      setCustomActive(false);
    }
  }, [value]);

  const showCustomInput = customActive || (Boolean(value.trim()) && !isPresetSkepticPersonaLabel(value));
  const triggerLabel = showCustomInput
    ? value.trim() || 'Custom persona (describe below)'
    : value || 'Select adversarial persona (optional)';

  return (
    <div className={clsx('relative', className)}>
      <label className="section-title block mb-2">Adversarial persona (optional)</label>
      <p className="text-xs text-slate-500 mb-2">
        Steers the challenge pass. Sent as supplemental context for this run only.
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
          <span className={value || customActive ? 'text-slate-200 truncate' : 'text-slate-500 truncate'}>
            {triggerLabel}
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
                aria-selected={
                  persona.id === 'custom'
                    ? showCustomInput
                    : value === persona.label
                }
                className={clsx(
                  'w-full px-3 py-2.5 text-left text-sm hover:bg-accent/10 transition-colors',
                  (persona.id === 'custom' ? showCustomInput : value === persona.label) && 'bg-accent/15'
                )}
                onClick={() => {
                  if (persona.id === 'custom') {
                    setCustomActive(true);
                    onChange('');
                  } else {
                    setCustomActive(false);
                    onChange(persona.label);
                  }
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
      {showCustomInput && !disabled ? (
        <textarea
          className="mt-2 w-full rounded-lg border border-surface-400/80 bg-surface-200/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none min-h-[72px] resize-y"
          placeholder="Describe the adversarial stance (e.g. regulatory auditor focused on primary-source gaps)…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom adversarial persona"
        />
      ) : null}
    </div>
  );
}
