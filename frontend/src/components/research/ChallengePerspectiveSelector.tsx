import { useEffect, useState } from 'react';
import { ChevronDown, UserX } from 'lucide-react';
import clsx from 'clsx';
import {
  CHALLENGE_PERSPECTIVE_OPTIONS,
  isPresetChallengePerspective,
} from '../../utils/challengePerspective';

export { CHALLENGE_PERSPECTIVE_OPTIONS };

type ChallengePerspectiveSelectorProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
};

/**
 * Optional steer for the challenge pass, sent as supplemental context.
 *
 * This used to be the “persona” picker on the Deep form only — a control
 * whose own label named the pipeline role. Every report is challenged now, so
 * it appears on the one form, and it says what it does in words a reader
 * recognises.
 */
export default function ChallengePerspectiveSelector({
  value,
  onChange,
  disabled = false,
  className,
}: ChallengePerspectiveSelectorProps) {
  const [open, setOpen] = useState(false);
  const [customActive, setCustomActive] = useState(
    () => Boolean(value.trim()) && !isPresetChallengePerspective(value)
  );

  useEffect(() => {
    if (!value.trim()) {
      setCustomActive(false);
      return;
    }
    if (isPresetChallengePerspective(value)) {
      setCustomActive(false);
    }
  }, [value]);

  const showCustomInput =
    customActive || (Boolean(value.trim()) && !isPresetChallengePerspective(value));
  const triggerLabel = showCustomInput
    ? value.trim() || 'Custom perspective (describe below)'
    : value || 'No particular perspective';

  return (
    <div className={clsx('relative', className)}>
      <label className="section-title block mb-2">Challenge perspective (optional)</label>
      <p className="text-xs text-slate-500 mb-2">
        Your report is argued against before it concludes. Pick whose objections it should have to
        survive, or leave this alone and we will choose from your request.
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
        <ChevronDown
          className={clsx('w-4 h-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && !disabled ? (
        <ul
          className="absolute z-20 mt-1 w-full rounded-lg border border-surface-400/80 bg-surface-100 shadow-xl max-h-64 overflow-y-auto"
          role="listbox"
        >
          {CHALLENGE_PERSPECTIVE_OPTIONS.map((perspective) => (
            <li key={perspective.id}>
              <button
                type="button"
                role="option"
                aria-selected={
                  perspective.id === 'custom' ? showCustomInput : value === perspective.label
                }
                className={clsx(
                  'w-full px-3 py-2.5 text-left text-sm hover:bg-accent/10 transition-colors',
                  (perspective.id === 'custom' ? showCustomInput : value === perspective.label) &&
                    'bg-accent/15'
                )}
                onClick={() => {
                  if (perspective.id === 'custom') {
                    setCustomActive(true);
                    onChange('');
                  } else {
                    setCustomActive(false);
                    onChange(perspective.label);
                  }
                  setOpen(false);
                }}
              >
                <span className="font-medium text-slate-200">{perspective.label}</span>
                <span className="block text-xs text-slate-500 mt-0.5">{perspective.description}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showCustomInput && !disabled ? (
        <textarea
          className="mt-2 w-full rounded-lg border border-surface-400/80 bg-surface-200/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none min-h-[72px] resize-y"
          placeholder="Describe the stance to argue from (for example: a regulator looking for gaps in primary sources)…"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label="Custom challenge perspective"
        />
      ) : null}
    </div>
  );
}
