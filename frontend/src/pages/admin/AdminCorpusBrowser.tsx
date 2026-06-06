import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

interface CorpusRow {
  sourceId: string;
  title: string | null;
  url: string | null;
  sourceType: string;
  documentCount: number;
  chunkCount: number;
  ownerUserId: string | null;
  ingestedAt: string;
}

interface CorpusResponse {
  search: string;
  limit: number;
  offset: number;
  total: number;
  consentFilterApplied: boolean;
  notice?: string;
  rows: CorpusRow[];
}

export default function AdminCorpusBrowser() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const corpusQuery = useQuery({
    queryKey: ['admin-corpus-list', search, offset, limit],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
      if (search.trim()) params.set('search', search.trim());
      return (await api.get<CorpusResponse>(`/admin/corpus/list?${params.toString()}`)).data;
    },
  });

  const data = corpusQuery.data;
  const canPrev = offset > 0;
  const canNext = data ? offset + limit < data.total : false;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-white">Shared corpus browser</h2>
        <p className="text-sm text-slate-400">
          Pipeline B sources with consent filtering applied. Read-only admin view.
        </p>
      </div>

      <form
        className="flex flex-wrap gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setSearch(searchInput.trim());
          setOffset(0);
        }}
      >
        <input
          type="search"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
          placeholder="Search title or URL"
          className="min-w-[16rem] flex-1 rounded border border-white/10 bg-slate-800 px-3 py-2 text-sm text-slate-100"
        />
        <button type="submit" className="rounded bg-indigo-600 px-4 py-2 text-sm hover:bg-indigo-500">
          Search
        </button>
      </form>

      {data?.notice ? <p className="text-xs text-amber-300">{data.notice}</p> : null}

      {corpusQuery.isLoading ? (
        <p className="text-sm text-slate-400">Loading corpus sources…</p>
      ) : corpusQuery.isError ? (
        <p className="text-sm text-red-400">Failed to load corpus list.</p>
      ) : data ? (
        <>
          <p className="text-sm text-slate-500">
            {data.consentFilterApplied ? 'Consent filter applied — ' : ''}
            Showing {data.rows.length} of {data.total} sources
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2">Docs</th>
                  <th className="px-3 py-2">Chunks</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Ingested</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.sourceId} className="border-t border-white/5 text-slate-200">
                    <td className="px-3 py-2 max-w-xs truncate" title={row.url ?? undefined}>
                      {row.title ?? row.url ?? row.sourceId.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2">{row.sourceType}</td>
                    <td className="px-3 py-2">{row.documentCount}</td>
                    <td className="px-3 py-2">{row.chunkCount}</td>
                    <td className="px-3 py-2">{row.ownerUserId ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.ingestedAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm disabled:opacity-40"
              disabled={!canPrev}
              onClick={() => setOffset((o) => Math.max(0, o - limit))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded bg-slate-800 px-3 py-1 text-sm disabled:opacity-40"
              disabled={!canNext}
              onClick={() => setOffset((o) => o + limit)}
            >
              Next
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}
