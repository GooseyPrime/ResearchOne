import type { RunArtifacts } from '../../utils/api';
import ShowAllList from '../ui/ShowAllList';

type NotUsedSource = NonNullable<RunArtifacts['notUsedSources']>[number];

/**
 * What a run found and did not use, with the reason in plain words.
 *
 * Diagnostics for administrators: the API sends this list to no one else, and
 * nothing is rendered when it is absent. The sources a run used are listed
 * separately, to everyone.
 *
 * A run can set aside several hundred results (292 on the run of 9 Oct 2026),
 * so the list is drawn a part at a time, with "Show all 292" (RJ-022B).
 */
export default function NotUsedSources({ sources }: { sources: readonly NotUsedSource[] | undefined }) {
  if (!sources || sources.length === 0) return null;
  return (
    <ShowAllList items={sources} className="space-y-2" testId="not-used-sources">
      {(source, index) => (
        <div
          key={`${index}-${source.stage}-${source.url ?? source.title ?? ''}`}
          className="p-3 rounded-lg bg-surface-200/30 border border-surface-100/20 space-y-1"
        >
          <p className="text-xs font-medium text-slate-300 truncate">{source.title || source.url || 'Untitled'}</p>
          {source.url && <p className="text-[10px] text-slate-500 truncate">{source.url}</p>}
          <p className="text-[11px] text-amber-300/90">{source.label}</p>
          {source.why && <p className="text-[10px] text-slate-500">{source.why}</p>}
        </div>
      )}
    </ShowAllList>
  );
}
