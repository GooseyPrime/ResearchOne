import clsx from 'clsx';
import { ExternalLink } from 'lucide-react';
import { extractApiError, type DossierSourceEntry } from '@/utils/api';
import { useDossierSources } from '@/hooks/useDossiers';

export default function DossierSourcesPanel({ dossierId }: { dossierId: string }) {
  const { data, isLoading, isError, error } = useDossierSources(dossierId);

  if (isLoading) {
    return <p className="text-sm text-slate-500">Loading dossier sources…</p>;
  }

  if (isError) {
    return (
      <p className="text-sm text-slate-500">
        {extractApiError(error) || 'Sources audit is not available for this dossier yet.'}
      </p>
    );
  }

  const sources = data?.sources ?? [];
  if (sources.length === 0) {
    return <p className="text-sm text-slate-500">No sources recorded for this dossier.</p>;
  }

  return (
    <div className="space-y-2">
      <p className="text-xs text-slate-500">
        Corpus sources tied to this dossier&apos;s research run — fetch/ingest status and citation linkage.
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-800/80">
        <table className="min-w-full text-xs">
          <thead className="bg-slate-950/60 text-slate-400 uppercase tracking-wide">
            <tr>
              <th className="text-left px-3 py-2 font-medium">Title / URL</th>
              <th className="text-left px-3 py-2 font-medium">Type</th>
              <th className="text-left px-3 py-2 font-medium">Fetch</th>
              <th className="text-left px-3 py-2 font-medium">Ingest</th>
              <th className="text-left px-3 py-2 font-medium">Cited</th>
              <th className="text-right px-3 py-2 font-medium">Chunks</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <SourceRow key={s.sourceId} source={s} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: DossierSourceEntry }) {
  const title = source.title?.trim() || source.url || 'Untitled source';
  return (
    <tr className="border-t border-slate-800/60 hover:bg-slate-900/30">
      <td className="px-3 py-2 text-slate-200 max-w-xs">
        <div className="truncate" title={title}>
          {title}
        </div>
        {source.url ? (
          <a
            href={source.url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent hover:underline truncate max-w-xs"
          >
            <ExternalLink size={10} />
            <span className="truncate">{source.url}</span>
          </a>
        ) : null}
      </td>
      <td className="px-3 py-2 text-slate-400">{source.sourceType ?? '—'}</td>
      <td className="px-3 py-2">
        <StatusPill value={source.fetchStatus} />
      </td>
      <td className="px-3 py-2">
        <StatusPill value={source.ingestionStatus} />
      </td>
      <td className="px-3 py-2">
        <span
          className={clsx(
            'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
            source.citedInReport ? 'bg-green-900/30 text-green-300' : 'bg-slate-800 text-slate-400',
          )}
        >
          {source.citedInReport ? 'yes' : 'no'}
        </span>
      </td>
      <td className="px-3 py-2 text-right text-slate-400 tabular-nums">
        {source.chunkCount ?? '—'}
      </td>
    </tr>
  );
}

function StatusPill({ value }: { value: string | null }) {
  const v = value ?? '—';
  const failed = v === 'failed';
  return (
    <span
      className={clsx(
        'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase',
        failed ? 'bg-amber-900/30 text-amber-300' : 'bg-slate-800 text-slate-300',
      )}
    >
      {v}
    </span>
  );
}
