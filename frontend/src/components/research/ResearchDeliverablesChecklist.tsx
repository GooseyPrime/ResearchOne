import type { RequestedArtifact } from './researchBriefTypes';

export default function ResearchDeliverablesChecklist({
  artifacts,
}: {
  artifacts: RequestedArtifact[];
}) {
  if (artifacts.length === 0) {
    return (
      <p className="text-xs text-slate-400">
        No explicit deliverables were detected. The plan will produce a structured research response.
      </p>
    );
  }

  return (
    <ul className="space-y-2 text-xs text-slate-200">
      {artifacts.map((artifact, idx) => (
        <li key={`${artifact.description}-${idx}`} className="rounded-lg border border-surface-100 bg-surface-200/40 px-3 py-2">
          <p className="font-medium text-slate-100">{artifact.description}</p>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-slate-400">
            {artifact.exactCount != null ? <span>Required count: {artifact.exactCount}</span> : null}
            {artifact.requiredFields && artifact.requiredFields.length > 0 ? (
              <span>Required fields: {artifact.requiredFields.join(', ')}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
