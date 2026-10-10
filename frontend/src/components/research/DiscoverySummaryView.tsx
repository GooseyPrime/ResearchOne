import ShowAllList from '../ui/ShowAllList';

/**
 * What a run's search found, as the run stored it (`research_runs.discovery_summary`).
 *
 * The diagnostics page used to print the stored record whole, as JSON: 390 KB
 * for the run of 9 Oct 2026, whose search returned 317 results (RJ-022B). It
 * also showed a customer the record's field names. This shows the counts, the
 * searches, and the results a part at a time. The reason a result was or was
 * not chosen, its rank and the provider's extract are the technical record and
 * are shown to administrators only; the server sends everyone else only the
 * results the run chose.
 *
 * "Chosen to read", not "read": the stored record marks a result `ingested`
 * when it is put in line to be fetched, and is not corrected if the fetch then
 * fails or does not finish in time. What the run did read and draw on is the
 * page's "Sources used" list, which comes from the stored sources.
 */

type StoredSource = {
  url?: unknown;
  title?: unknown;
  snippet?: unknown;
  provider?: unknown;
  sourceQuery?: unknown;
  selectionRationale?: unknown;
  ingested?: unknown;
};

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');
const count = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/** A sentence of counts: "5 searches · 317 results found · 25 chosen to read · 292 not chosen". */
function countsLine(summary: Record<string, unknown>, sources: readonly StoredSource[], isAdmin: boolean): string {
  const parts: string[] = [];
  const queries = Array.isArray(summary.queriesExecuted) ? summary.queriesExecuted.length : null;
  if (queries != null) parts.push(plural(queries, 'search', 'searches'));
  const found = count(summary.candidatesFound);
  if (found != null) parts.push(plural(found, 'result found', 'results found'));
  const chosen = count(summary.sourcesIngested) ?? sources.filter((source) => source.ingested === true).length;
  parts.push(`${chosen} chosen to read`);
  const skipped = count(summary.sourcesSkipped);
  if (isAdmin && skipped != null) parts.push(`${skipped} not chosen`);
  return parts.join(' · ');
}

export default function DiscoverySummaryView({
  summary,
  isAdmin,
}: {
  summary: Record<string, unknown>;
  isAdmin: boolean;
}) {
  const sources: StoredSource[] = Array.isArray(summary.sources)
    ? summary.sources.filter((entry): entry is StoredSource => Boolean(entry) && typeof entry === 'object')
    : [];
  const queries = Array.isArray(summary.queriesExecuted)
    ? summary.queriesExecuted.filter((query): query is string => typeof query === 'string' && query.trim() !== '')
    : [];
  const planRationale = text(summary.planRationale);
  // Everything but the list of results: a few lines, where the whole record is hundreds of kilobytes.
  const { sources: _sources, ...record } = summary;
  void _sources;

  return (
    <div className="space-y-3" data-testid="discovery-summary">
      <p className="text-xs text-slate-300">{countsLine(summary, sources, isAdmin)}</p>

      {queries.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Searches</div>
          <ul className="text-xs text-slate-300 list-disc pl-4 space-y-0.5">
            {queries.map((query, index) => (
              <li key={index} className="break-words">{query}</li>
            ))}
          </ul>
        </div>
      )}

      {isAdmin && planRationale && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">Why the web was searched</div>
          <p className="text-xs text-slate-400 leading-relaxed">{planRationale}</p>
        </div>
      )}

      {sources.length > 0 && (
        <div>
          <div className="text-[10px] uppercase tracking-widest text-slate-600 mb-1">
            {isAdmin ? `Search results (${sources.length})` : `Sources chosen to read (${sources.length})`}
          </div>
          <ShowAllList items={sources} className="space-y-1.5" testId="discovery-sources">
            {(source, index) => {
              const url = text(source.url);
              const snippet = text(source.snippet);
              const rationale = text(source.selectionRationale);
              return (
                <div key={index} className="text-xs bg-surface-200/40 border border-surface-100/20 rounded p-2 space-y-1">
                  <div className="flex items-start gap-2">
                    <p className="flex-1 min-w-0 font-medium text-slate-200 truncate">{text(source.title) || url || 'Untitled'}</p>
                    {isAdmin && (
                      <span className={source.ingested === true ? 'text-[10px] text-green-400 flex-shrink-0' : 'text-[10px] text-slate-500 flex-shrink-0'}>
                        {source.ingested === true ? 'Chosen to read' : 'Not chosen'}
                      </span>
                    )}
                  </div>
                  {url && (
                    <a href={url} target="_blank" rel="noopener noreferrer" className="block text-[10px] text-accent hover:underline truncate">
                      {url}
                    </a>
                  )}
                  {isAdmin && rationale && <p className="text-[10px] text-amber-300/90 break-words">{rationale}</p>}
                  {isAdmin && (text(source.provider) || text(source.sourceQuery)) && (
                    <p className="text-[10px] text-slate-500 break-words">
                      {[text(source.provider), text(source.sourceQuery)].filter(Boolean).join(' · ')}
                    </p>
                  )}
                  {isAdmin && snippet && <p className="text-[10px] text-slate-500 line-clamp-2">{snippet}</p>}
                </div>
              );
            }}
          </ShowAllList>
        </div>
      )}

      {isAdmin && (
        <details className="text-xs">
          <summary className="cursor-pointer text-slate-500">Stored record, without the list of results</summary>
          <pre className="mt-1 text-[11px] font-mono text-slate-300 bg-[#080a10] rounded border border-surface-100/20 p-3 overflow-x-auto whitespace-pre-wrap max-h-72 overflow-y-auto">
            {JSON.stringify(record, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}
