import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

interface ReportRow {
  reportId: string;
  title: string;
  status: string;
  runId: string | null;
  runTitle: string | null;
  runStatus: string | null;
  userId: string | null;
  userEmail: string | null;
  createdAt: string;
  finalizedAt: string | null;
}

interface ReportsResponse {
  days: number;
  limit: number;
  offset: number;
  total: number;
  rows: ReportRow[];
}

export default function AdminReportsBrowser() {
  const [days, setDays] = useState(30);
  const [offset, setOffset] = useState(0);
  const limit = 25;

  const reportsQuery = useQuery({
    queryKey: ['admin-reports', days, offset, limit],
    queryFn: async () =>
      (
        await api.get<ReportsResponse>(
          `/admin/reports?days=${days}&limit=${limit}&offset=${offset}`,
        )
      ).data,
  });

  const data = reportsQuery.data;
  const canPrev = offset > 0;
  const canNext = data ? offset + limit < data.total : false;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold text-white">Reports browser</h2>
          <p className="text-sm text-slate-400">Recent finalized and in-progress reports across tenants.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          Window
          <select
            className="rounded border border-white/10 bg-slate-800 px-2 py-1 text-sm"
            value={days}
            onChange={(e) => {
              setDays(Number(e.target.value));
              setOffset(0);
            }}
          >
            <option value={7}>7 days</option>
            <option value={30}>30 days</option>
            <option value={90}>90 days</option>
          </select>
        </label>
      </div>

      {reportsQuery.isLoading ? (
        <p className="text-sm text-slate-400">Loading reports…</p>
      ) : reportsQuery.isError ? (
        <p className="text-sm text-red-400">Failed to load reports.</p>
      ) : data ? (
        <>
          <p className="text-sm text-slate-500">
            Showing {data.rows.length} of {data.total} reports
          </p>
          <div className="overflow-x-auto rounded-lg border border-white/10">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-900/80 text-slate-400">
                <tr>
                  <th className="px-3 py-2">Title</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Run</th>
                  <th className="px-3 py-2">User</th>
                  <th className="px-3 py-2">Created</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row) => (
                  <tr key={row.reportId} className="border-t border-white/5 text-slate-200">
                    <td className="px-3 py-2">
                      <Link to={`/app/reports/${row.reportId}`} className="text-indigo-300 hover:text-indigo-200">
                        {row.title || row.reportId.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-3 py-2">{row.status}</td>
                    <td className="px-3 py-2">
                      {row.runId ? (
                        <span title={row.runTitle ?? undefined}>{row.runStatus ?? '—'}</span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-3 py-2">{row.userEmail ?? row.userId ?? '—'}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {new Date(row.createdAt).toLocaleString()}
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
