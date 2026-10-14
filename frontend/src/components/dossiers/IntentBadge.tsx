import clsx from 'clsx';
import { INTENT_DISPLAY_LABELS } from '../../lib/intents';

/**
 * The report type of a dossier. A run with no saved plan has no report type.
 * "Earlier report" is for a finished report made before report types existed;
 * a run that stopped before its plan was saved is not one, so for it nothing
 * is shown rather than a label that says it is old.
 */
export default function IntentBadge({ intent, runStatus }: { intent: string | null | undefined; runStatus?: string | null }) {
  const named = intent?.trim();
  if (!named && runStatus && runStatus !== 'completed') return null;
  const key = named || 'legacy';
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
