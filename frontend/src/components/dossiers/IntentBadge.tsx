import clsx from 'clsx';
import { INTENT_DISPLAY_LABELS } from '../../lib/intents';

export default function IntentBadge({ intent }: { intent: string | null | undefined }) {
  const key = intent?.trim() || 'legacy';
  const label = INTENT_DISPLAY_LABELS[key] ?? key.replace(/_/g, ' ');
  return (
    <span
      className={clsx(
        'badge border text-[10px] uppercase tracking-wide',
        key === 'legacy'
          ? 'border-slate-600/50 text-slate-400 bg-slate-900/40'
          : 'border-accent/30 text-accent bg-accent/10',
      )}
    >
      {label}
    </span>
  );
}
