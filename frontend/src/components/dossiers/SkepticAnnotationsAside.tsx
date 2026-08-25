import { useId, useState } from 'react';
import clsx from 'clsx';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReportMarkdown from '../reports/ReportMarkdown';

function annotationText(item: unknown): string {
  if (typeof item === 'string') return item;
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    const body =
      (typeof o.text === 'string' && o.text) ||
      (typeof o.body === 'string' && o.body) ||
      (typeof o.note === 'string' && o.note) ||
      (typeof o.content === 'string' && o.content);
    if (body) return body;
    try {
      return JSON.stringify(o, null, 2);
    } catch {
      return '';
    }
  }
  return '';
}

function annotationTitle(item: unknown, index: number): string {
  if (item && typeof item === 'object') {
    const o = item as Record<string, unknown>;
    if (typeof o.title === 'string' && o.title.trim()) return o.title.trim();
    if (typeof o.claim === 'string' && o.claim.trim()) return o.claim.trim().slice(0, 120);
  }
  return `Cross-check ${index + 1}`;
}

type Props = {
  annotations: unknown[];
  className?: string;
};

/**
 * Collapsible skeptical cross-checks (annotate-mode); Wave 4 vocabulary — not
 * "evidence" for retrieved text.
 *
 * Renders through `ReportMarkdown`, not a bare `ReactMarkdown`. This component
 * used to instantiate its own without `remark-gfm`, so an annotation
 * containing a table arrived as a literal wall of `|` characters — the exact
 * defect `ReportMarkdown` was extracted to eliminate (WO-AD §9B, done-item 7).
 */
export default function SkepticAnnotationsAside({ annotations, className }: Props) {
  const panelId = useId();
  const [open, setOpen] = useState(true);
  if (!annotations.length) return null;

  return (
    <aside
      className={clsx(
        'rounded-lg border border-slate-700/80 bg-slate-950/40 text-sm text-slate-200',
        className,
      )}
    >
      <button
        type="button"
        id={`${panelId}-toggle`}
        aria-expanded={open}
        aria-controls={`${panelId}-panel`}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-slate-100 hover:bg-slate-900/60 rounded-t-lg"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="font-medium">Challenge notes</span>
        {open ? <ChevronDown size={18} className="shrink-0 text-slate-400" /> : <ChevronRight size={18} className="shrink-0 text-slate-400" />}
      </button>
      {open ? (
        <div id={`${panelId}-panel`} role="region" aria-labelledby={`${panelId}-toggle`} className="border-t border-slate-800/80 px-3 py-2 space-y-3 max-h-[min(70vh,520px)] overflow-y-auto">
          {annotations.map((item, i) => (
            <div key={i} className="rounded-md border border-slate-800/60 bg-slate-900/30 p-2">
              <h3 className="text-xs font-semibold text-accent mb-1">{annotationTitle(item, i)}</h3>
              <div className="prose prose-invert prose-sm max-w-none text-slate-300">
                <ReportMarkdown>{annotationText(item)}</ReportMarkdown>
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </aside>
  );
}
