import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import api from '../../utils/api';

export default function RunTelemetry() {
  const [days, setDays] = useState(30);

  const telemetryQuery = useQuery({
    queryKey: ['admin-telemetry', days],
    queryFn: async () => (await api.get(`/admin/telemetry/runs?days=${days}`)).data as {
      stats: Array<Record<string, unknown>>;
      daily: Array<Record<string, unknown>>;
    },
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h2 className="text-lg font-medium">Run Telemetry</h2>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}
          className="rounded bg-slate-800 border border-white/10 px-2 py-1 text-sm text-white">
          <option value={7}>7 days</option>
          <option value={30}>30 days</option>
          <option value={90}>90 days</option>
        </select>
      </div>

      {telemetryQuery.data?.stats && (
        <>
          <h3 className="text-sm font-medium text-slate-300 mt-2">By Objective</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-white/10">
                <th className="py-2">Objective</th>
                <th>Total</th>
                <th>Completed</th>
                <th>Failed</th>
                <th>Avg Runtime</th>
              </tr>
            </thead>
            <tbody>
              {telemetryQuery.data.stats.map((row, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1.5 font-mono text-xs">{String(row.research_objective ?? 'v1')}</td>
                  <td>{String(row.total_runs)}</td>
                  <td className="text-emerald-400">{String(row.completed)}</td>
                  <td className="text-red-400">{String(row.failed)}</td>
                  <td>{row.avg_runtime_seconds ? `${Math.round(Number(row.avg_runtime_seconds))}s` : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {telemetryQuery.data?.daily && telemetryQuery.data.daily.length > 0 && (
        <>
          <h3 className="text-sm font-medium text-slate-300 mt-4">Daily Breakdown</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-400 border-b border-white/10">
                <th className="py-2">Day</th>
                <th>Status</th>
                <th>Count</th>
              </tr>
            </thead>
            <tbody>
              {telemetryQuery.data.daily.map((row, i) => (
                <tr key={i} className="border-b border-white/5">
                  <td className="py-1 text-xs">{String(row.day)}</td>
                  <td className={`text-xs ${row.status === 'completed' ? 'text-emerald-400' : row.status === 'failed' ? 'text-red-400' : 'text-slate-400'}`}>
                    {String(row.status)}
                  </td>
                  <td>{String(row.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
