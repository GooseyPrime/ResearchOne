import { Link } from 'react-router-dom';
import { format } from 'date-fns';
import type { DossierTimelineRow } from '@/utils/api';

const EVENT_LABELS: Record<string, string> = {
  initial_run: 'Initial run',
  report_revision: 'Report revision',
  research_spinoff: 'Research spinoff',
  plan_refinement: 'Plan refinement',
};

function eventLabel(type: string): string {
  return EVENT_LABELS[type] ?? type.replace(/_/g, ' ');
}

export default function DossiersTimelineTable({ rows }: { rows: DossierTimelineRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="card p-10 text-center text-slate-400 text-sm">
        No timeline events match your filters.
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-950/70 text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800">
            <tr>
              <th className="text-left px-4 py-3 font-medium whitespace-nowrap">Occurred</th>
              <th className="text-left px-4 py-3 font-medium">Event</th>
              <th className="text-left px-4 py-3 font-medium min-w-[12rem]">Dossier / query</th>
              <th className="text-left px-4 py-3 font-medium">Rev #</th>
              <th className="text-left px-4 py-3 font-medium">Engine</th>
              <th className="text-left px-4 py-3 font-medium">Links</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={`${row.occurredAt}-${row.eventType}-${row.runId ?? row.reportId ?? i}`}
                className="border-b border-slate-800/60 hover:bg-slate-900/30"
              >
                <td className="px-4 py-2.5 text-slate-400 whitespace-nowrap tabular-nums text-xs">
                  {format(new Date(row.occurredAt), 'yyyy-MM-dd HH:mm')}
                </td>
                <td className="px-4 py-2.5">
                  <span className="text-slate-200">{eventLabel(String(row.eventType))}</span>
                  {row.runStatus ? (
                    <span className="block text-[10px] text-slate-500 mt-0.5">{row.runStatus}</span>
                  ) : null}
                </td>
                <td className="px-4 py-2.5 max-w-xs">
                  {row.dossierId ? (
                    <Link
                      to={`/app/dossiers/${row.dossierId}`}
                      className="text-accent hover:underline line-clamp-2"
                      title={row.query ?? undefined}
                    >
                      {row.query || row.dossierId.slice(0, 8)}
                    </Link>
                  ) : (
                    <span className="text-slate-400 line-clamp-2">{row.query ?? '—'}</span>
                  )}
                </td>
                <td className="px-4 py-2.5 text-slate-400 tabular-nums text-xs">
                  {row.revisionNumber ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-slate-400 text-xs uppercase">
                  {row.engineVersion ?? '—'}
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex flex-wrap gap-2 text-xs">
                    {row.reportId ? (
                      <Link to={`/app/reports/${row.reportId}`} className="text-accent hover:underline">
                        Report
                      </Link>
                    ) : null}
                    {row.runId ? (
                      <Link to={`/app/run/${row.runId}`} className="text-accent hover:underline">
                        Run
                      </Link>
                    ) : null}
                    {row.runId ? (
                      <Link to={`/app/reports/run/${row.runId}`} className="text-slate-400 hover:text-accent">
                        Logs
                      </Link>
                    ) : null}
                    {!row.reportId && !row.runId ? (
                      <span className="text-slate-600">—</span>
                    ) : null}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function timelineRowsToCsv(rows: DossierTimelineRow[]): string {
  const header = ['occurredAt', 'eventType', 'dossierId', 'query', 'revisionNumber', 'engineVersion', 'runStatus', 'reportId', 'runId'];
  const escape = (v: string | number | null | undefined) => {
    const s = v == null ? '' : String(v);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [
    header.join(','),
    ...rows.map((r) =>
      [
        r.occurredAt,
        r.eventType,
        r.dossierId,
        r.query,
        r.revisionNumber,
        r.engineVersion,
        r.runStatus,
        r.reportId,
        r.runId,
      ]
        .map(escape)
        .join(','),
    ),
  ];
  return lines.join('\n');
}
