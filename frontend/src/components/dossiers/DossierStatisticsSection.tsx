import type { DossierStats } from '../../utils/api';
import { INTENT_DISPLAY_LABELS } from '../../constants/intentLabels';
import { buildOrchestrationHeadline, parseJsonStringArray, profileDisplayNameFromStats } from '../../lib/dossierOrchestrationSummary';
import SourceClassBadge from './SourceClassBadge';
import { SOURCE_CLASS_IDS, sourceClassLabel } from './sourceClassIds';

type Props = {
  stats: DossierStats;
  planIntent: string;
};

function Stat({ label, value }: { label: string; value: number | null | undefined }) {
  return (
    <li className="flex justify-between gap-4 border border-slate-800/60 rounded-md px-3 py-2">
      <span className="text-slate-500">{label}</span>
      <span className="text-slate-100 font-mono text-xs">{value ?? '—'}</span>
    </li>
  );
}

function sourceClassEntries(breakdown: Record<string, unknown> | null): Array<{ key: string; n: number }> {
  if (!breakdown || typeof breakdown !== 'object') return [];
  const rows: Array<{ key: string; n: number }> = [];
  for (const key of SOURCE_CLASS_IDS) {
    const raw = breakdown[key];
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) rows.push({ key, n });
  }
  for (const [key, raw] of Object.entries(breakdown)) {
    if ((SOURCE_CLASS_IDS as readonly string[]).includes(key)) continue;
    const n = typeof raw === 'number' ? raw : Number(raw);
    if (Number.isFinite(n) && n > 0) rows.push({ key, n });
  }
  return rows.sort((a, b) => b.n - a.n);
}

export default function DossierStatisticsSection({ stats, planIntent }: Props) {
  const headline = buildOrchestrationHeadline(stats, INTENT_DISPLAY_LABELS[planIntent] ?? null);
  const profile = profileDisplayNameFromStats(stats);
  const skipped = parseJsonStringArray(stats.agentsSkipped);
  const ran = parseJsonStringArray(stats.agentsRan);
  const classRows = sourceClassEntries(stats.sourceClassBreakdown);

  return (
    <div className="space-y-4">
      <h2 className="text-white font-medium">Statistics</h2>

      {headline ? (
        <p className="rounded-md border border-accent/25 bg-accent/5 px-3 py-2 text-sm text-slate-100 leading-snug">
          {headline}
        </p>
      ) : null}

      {(profile || skipped.length > 0) && (
        <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-slate-400">
          {profile ? (
            <div className="rounded-md border border-slate-800/60 px-3 py-2">
              <dt className="text-slate-500 uppercase tracking-wide">Orchestration profile</dt>
              <dd className="text-slate-200 mt-0.5">{profile}</dd>
            </div>
          ) : null}
          {skipped.length > 0 ? (
            <div className="rounded-md border border-slate-800/60 px-3 py-2">
              <dt className="text-slate-500 uppercase tracking-wide">Stages skipped</dt>
              <dd className="text-slate-200 mt-0.5 font-mono">{skipped.length}</dd>
            </div>
          ) : null}
          {ran.length > 0 ? (
            <div className="rounded-md border border-slate-800/60 px-3 py-2 sm:col-span-2">
              <dt className="text-slate-500 uppercase tracking-wide">Stages executed</dt>
              <dd className="text-slate-300 mt-0.5 break-words">{ran.join(', ')}</dd>
            </div>
          ) : null}
        </dl>
      )}

      <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-slate-300">
        <Stat label="Duration (ms)" value={stats.totalDurationMs} />
        <Stat label="Tokens in" value={stats.tokensInput} />
        <Stat label="Tokens out" value={stats.tokensOutput} />
        <Stat label="Sources cited" value={stats.sourcesCitedCount} />
        <Stat label="Sources retrieved" value={stats.sourcesRetrievedCount} />
        <Stat label="Formulation enhancement passes" value={stats.steelmanPassCount} />
        <Stat label="Challenge notes" value={stats.skepticAnnotationsCount} />
        <Stat label="Contradictions" value={stats.contradictionsCount} />
      </ul>

      {classRows.length > 0 ? (
        <div className="rounded-md border border-slate-800/60 p-3 space-y-2">
          <h3 className="text-xs uppercase tracking-wide text-slate-500">Retrieved sources by class</h3>
          <p className="text-[11px] text-slate-500 leading-snug">
            Counts refer to classified retrieved passages — orthogonal to source-corroboration tiers on citations.
          </p>
          <ul className="space-y-2">
            {classRows.map(({ key, n }) => (
              <li key={key} className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <span className="flex min-w-0 flex-1 items-center gap-2">
                  <SourceClassBadge sourceClass={key} />
                  {(SOURCE_CLASS_IDS as readonly string[]).includes(key) ? null : (
                    <span className="truncate text-[11px] text-slate-400">{sourceClassLabel(key)}</span>
                  )}
                </span>
                <span className="shrink-0 font-mono text-slate-200">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
