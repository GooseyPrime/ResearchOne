import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import ReportMarkdown from '../reports/ReportMarkdown';

/**
 * The run's original request, collapsed.
 *
 * The run page used to render `run.query` as its `<h1>` at
 * `text-xl sm:text-2xl font-bold`. A research prompt is thousands of characters
 * of Markdown, so the heading became a wall of bold text with literal `#`, `**`
 * and `---` in it, and the actual page began below the fold.
 *
 * The request still matters — it is what the user asked for and they need to be
 * able to check it — so it is available on demand rather than removed. Rendered
 * as Markdown because it was written as Markdown, inside a bounded scroll so a
 * long prompt cannot push the page down, and with `break-words` so an unbroken
 * token (a URL in the prompt) cannot widen the page. `<main>` is
 * `overflow-y-auto`, which per CSS spec computes `overflow-x` to `auto` as
 * well, so an unbroken token really does make the whole app scroll sideways —
 * measured at `scrollWidth` 5372 against a 1680px viewport.
 *
 * `plainTables` because this is a prompt, not a report: a request that happens
 * to contain a Markdown table wants to be shown as written, not turned into a
 * sortable exportable data grid.
 */
export interface RunRequestDisclosureProps {
  request: string;
  supplemental?: string | null;
  /** Open on mount. Used by the queued state, where there is nothing else yet. */
  defaultOpen?: boolean;
}

export default function RunRequestDisclosure({
  request,
  supplemental,
  defaultOpen = false,
}: RunRequestDisclosureProps) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = request?.trim() ?? '';
  if (!trimmed) return null;

  return (
    <div className="r1-panel">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left r1-focus-ring"
      >
        {open ? (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-r1-dim" aria-hidden />
        ) : (
          <ChevronRight className="h-4 w-4 flex-shrink-0 text-r1-dim" aria-hidden />
        )}
        <span className="r1-mono-label text-[10px]">REQUEST</span>
        {!open && (
          <span className="min-w-0 flex-1 truncate text-xs text-r1-dim">{trimmed}</span>
        )}
      </button>

      {open && (
        <div className="border-t border-r1-border px-4 py-3">
          <div className="max-h-72 overflow-y-auto break-words text-sm text-r1-muted [overflow-wrap:anywhere]">
            <ReportMarkdown plainTables>{trimmed}</ReportMarkdown>
          </div>

          {supplemental?.trim() ? (
            <div className="mt-3 border-t border-r1-border pt-3">
              <span className="r1-mono-label mb-2 block text-[10px]">SUPPLEMENTAL</span>
              <div className="max-h-48 overflow-y-auto break-words text-sm text-r1-muted [overflow-wrap:anywhere]">
                <ReportMarkdown plainTables>{supplemental.trim()}</ReportMarkdown>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
