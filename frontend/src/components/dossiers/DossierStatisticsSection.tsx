import type { DossierStats } from '../../utils/api';
import { INTENT_SHORT_DESCRIPTIONS } from '../../lib/intents';
import { buildOrchestrationHeadline, parseJsonStringArray, profileDisplayNameFromStats } from '../../lib/dossierOrchestrationSummary';

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

export default function DossierStatisticsSection({ stats, planIntent }: Props) {
  const headline = buildOrchestrationHeadline(stats, INTENT_SHORT_DESCRIPTIONS[planIntent] ?? null);
  const profile = profileDisplayNameFromStats(stats);
  const skipped = parseJsonStringArray(stats.agentsSkipped);
  const ran = parseJsonStringArray(stats.agentsRan);

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
        <Stat label="Skeptical annotations" value={stats.skepticAnnotationsCount} />
        <Stat label="Contradictions" value={stats.contradictionsCount} />
      </ul>
    </div>
  );
}
