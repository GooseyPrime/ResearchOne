import { useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  downloadCsv,
  parseTableNode,
  toTsv,
  type ParsedTable,
} from './reportTables';

/**
 * Shared markdown renderer for report content (WO-AB).
 *
 * Two problems this solves:
 *
 * 1. `DossierReportSection` rendered `<ReactMarkdown>` WITHOUT `remark-gfm`.
 *    GFM tables are not part of CommonMark, so a ranked portfolio table
 *    arrived as a literal wall of `|` characters. `ReportDetailPage` did have
 *    the plugin, which is why the full report workspace looked better.
 *
 * 2. Even with the plugin, an 18-column ranked portfolio as a plain `<table>`
 *    is unusable. Tables now render as a data grid: sticky header, sortable
 *    columns, bounded scroll, and export to CSV or clipboard TSV so the data
 *    goes straight into Excel or Google Sheets.
 */

export function DataGrid({
  table,
  caption,
}: {
  table: ParsedTable;
  caption?: string;
}): JSX.Element {
  const [sort, setSort] = useState<{ col: number; dir: 'asc' | 'desc' } | null>(null);
  const [copied, setCopied] = useState(false);

  const rows = useMemo(() => {
    if (!sort) return table.rows;
    // Numeric-aware so rank/score columns sort as numbers, not strings.
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...table.rows].sort((a, b) => {
      const cmp = collator.compare(a[sort.col] ?? '', b[sort.col] ?? '');
      return sort.dir === 'asc' ? cmp : -cmp;
    });
  }, [table.rows, sort]);

  const sorted: ParsedTable = { headers: table.headers, rows };
  const filename = `${(caption ?? 'table').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.csv`;

  const copyTsv = async () => {
    try {
      await navigator.clipboard.writeText(toTsv(sorted));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <figure className="my-4">
      <figcaption className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-xs text-slate-400">
          {table.rows.length} {table.rows.length === 1 ? 'row' : 'rows'} · {table.headers.length}{' '}
          columns{sort ? ' · sorted' : ' · select a column heading to sort'}
        </span>
        <span className="flex gap-2">
          <button
            type="button"
            onClick={copyTsv}
            className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-surface-200"
          >
            {copied ? 'Copied' : 'Copy for Sheets'}
          </button>
          <button
            type="button"
            onClick={() => downloadCsv(sorted, filename)}
            className="text-xs px-2 py-1 rounded border border-slate-600 hover:bg-surface-200"
          >
            Download CSV
          </button>
        </span>
      </figcaption>

      <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded border border-slate-700">
        <table className="min-w-full text-sm border-collapse">
          <thead className="sticky top-0 z-10 bg-surface-200">
            <tr>
              {table.headers.map((header, i) => {
                const active = sort?.col === i;
                return (
                  <th
                    key={`${header}-${i}`}
                    scope="col"
                    aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
                    className="text-left font-semibold px-3 py-2 border-b border-slate-700 whitespace-nowrap"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setSort((prev) =>
                          prev?.col === i
                            ? { col: i, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
                            : { col: i, dir: 'asc' }
                        )
                      }
                      className="inline-flex items-center gap-1 hover:text-white"
                    >
                      {header || `Column ${i + 1}`}
                      <span aria-hidden="true" className="text-slate-500">
                        {active ? (sort.dir === 'asc' ? '▲' : '▼') : '↕'}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, r) => (
              <tr key={r} className="odd:bg-surface-100/40 align-top">
                {table.headers.map((_, c) => (
                  <td key={c} className="px-3 py-2 border-b border-slate-800">
                    {row[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}

export interface ReportMarkdownProps {
  children: string;
  /** Render plain tables instead of the data grid (for very tight layouts). */
  plainTables?: boolean;
  /** Used to name the exported file. */
  tableCaption?: string;
}

export default function ReportMarkdown({
  children,
  plainTables,
  tableCaption,
}: ReportMarkdownProps): JSX.Element {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        table: ({ children: tableChildren }) => {
          const parsed = plainTables ? null : parseTableNode(tableChildren);
          if (!parsed) {
            return (
              <div className="overflow-x-auto my-3">
                <table className="min-w-full text-sm border-collapse">{tableChildren}</table>
              </div>
            );
          }
          return <DataGrid table={parsed} caption={tableCaption} />;
        },
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
