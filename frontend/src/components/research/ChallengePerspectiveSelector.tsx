import { useEffect, useState } from 'react';
import { ChevronDown, UserX } from 'lucide-react';
import clsx from 'clsx';
import {
  CHALLENGE_PERSPECTIVE_OPTIONS,
  NO_VIEWPOINT,
  isPresetChallengePerspective,
} from '../../utils/challengePerspective';
import { DOUBLE_CHECK, customerOption, customerOptionHelp } from '../../content/customerOptions';

export { CHALLENGE_PERSPECTIVE_OPTIONS };

type ChallengePerspectiveSelectorProps = {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  className?: string;
};

const FIELD = customerOption('request_field', 'check_viewpoint');
const CUSTOM = customerOption('check_viewpoint', 'custom');

/**
 * Optional steer for Double-check, sent as supplemental context.
 *
 * Every report is double-checked, so the control appears on the one form. It
 * says what Double-check is, with its example, and each viewpoint says what
 * it does. All of those words come from the registry of customer-facing names.
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
    ? value.trim() || `${CUSTOM.name} (describe below)`
    : value || NO_VIEWPOINT.name;

  return (
    <div className={clsx('relative', className)}>
      <label className="section-title block mb-2">{FIELD.name}</label>
      <p className="text-xs text-slate-500 mb-2" data-testid="double-check-description">
        {DOUBLE_CHECK.description}
      </p>
      <p className="text-xs text-slate-500 mb-2" data-testid="double-check-example">
        Example: {DOUBLE_CHECK.example}
      </p>
      <p className="text-xs text-slate-500 mb-2">{FIELD.description}</p>
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
                <span className="block text-xs text-slate-500 mt-0.5">
                  {customerOptionHelp(perspective)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {showCustomInput && !disabled ? (
        <textarea
          className="mt-2 w-full rounded-lg border border-surface-400/80 bg-surface-200/40 px-3 py-2 text-sm text-slate-200 placeholder:text-slate-500 focus:border-accent/50 focus:outline-none min-h-[72px] resize-y"
          placeholder={`${CUSTOM.description} For example: ${CUSTOM.example}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={CUSTOM.name}
        />
      ) : null}
    </div>
  );
}
