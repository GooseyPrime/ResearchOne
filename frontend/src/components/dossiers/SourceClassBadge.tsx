/**
 * Wave 5.3 — labels how retrieved sources sit in public controversy / agreement dynamics.
 * Orthogonal to source-corroboration tiers (Rule 31: "sources" vocabulary on surfaces).
 */
import { isSourceClassId, sourceClassBadgeShortLabel, type SourceClassId } from './sourceClassIds';

/** Maps API `source_class` strings to badge styling (Tailwind `sourceClass.*` palette). */
const PALETTE: Record<SourceClassId, string> = {
  suppressed_and_recovered:
    'border-violet-500/40 bg-sourceClass-suppressed_and_recovered/15 text-violet-100',
  actively_contested: 'border-orange-500/40 bg-sourceClass-actively_contested/15 text-orange-100',
  consensus_held: 'border-emerald-500/40 bg-sourceClass-consensus_held/15 text-emerald-100',
  consensus_collapsed: 'border-slate-500/40 bg-sourceClass-consensus_collapsed/20 text-slate-100',
};

type Props = {
  sourceClass: string | null | undefined;
  className?: string;
};

export default function SourceClassBadge({ sourceClass, className = '' }: Props) {
  if (!sourceClass || !isSourceClassId(sourceClass)) return null;
  const label = sourceClassBadgeShortLabel(sourceClass);
  const palette = PALETTE[sourceClass];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-semibold leading-tight ${palette} ${className}`.trim()}
      title={`Source class: ${label}`}
    >
      {label}
    </span>
  );
}
