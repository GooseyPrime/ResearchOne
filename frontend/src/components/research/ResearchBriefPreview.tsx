import { INTENT_DISPLAY_LABELS } from '../../lib/intents';
import { humanizeIdentifier } from '../../utils/formatIdentifiers';
import ResearchDeliverablesChecklist from './ResearchDeliverablesChecklist';
import ResearchAssumptionsEditor from './ResearchAssumptionsEditor';
import type { RequestedArtifact } from './researchBriefTypes';

type UserConstraint = {
  description: string;
};

type ResearchBrief = {
  primaryIntent?: string;
  secondaryIntent?: string;
  requestedArtifacts?: RequestedArtifact[];
  userConstraints?: UserConstraint[];
  confidence?: number;
};

function readResearchBrief(planPayload: Record<string, unknown>): ResearchBrief | null {
  const brief = planPayload.researchBrief;
  if (!brief || typeof brief !== 'object') return null;
  return brief as ResearchBrief;
}

function readIntentId(planPayload: Record<string, unknown>, brief: ResearchBrief | null): string | undefined {
  if (typeof brief?.primaryIntent === 'string' && brief.primaryIntent.trim()) return brief.primaryIntent;
  const fromPlan = (planPayload.intent as Record<string, unknown> | undefined)?.id;
  return typeof fromPlan === 'string' && fromPlan.trim() ? fromPlan : undefined;
}

function inferredAssumptions(planPayload: Record<string, unknown>): string[] {
  const assumptions: string[] = [];
  const topic = (planPayload.topicAnalysis as Record<string, unknown> | undefined)?.summary;
  if (typeof topic === 'string' && topic.trim()) {
    assumptions.push(`Topic interpretation: ${topic.trim()}`);
  }
  const sourceSummary = (planPayload.sourceStrategy as Record<string, unknown> | undefined)?.summary;
  if (typeof sourceSummary === 'string' && sourceSummary.trim()) {
    assumptions.push(`Source strategy: ${sourceSummary.trim()}`);
  }
  return assumptions;
}

export default function ResearchBriefPreview({
  planPayload,
  disabled = false,
  onAssumptionEditsReady,
}: {
  planPayload: Record<string, unknown>;
  disabled?: boolean;
  onAssumptionEditsReady?: (instruction: string) => void;
}) {
  const brief = readResearchBrief(planPayload);
  const intentId = readIntentId(planPayload, brief);
  const confidence =
    typeof brief?.confidence === 'number'
      ? brief.confidence
      : ((planPayload.intent as Record<string, unknown> | undefined)?.confidence as number | undefined);
  const deliverables = brief?.requestedArtifacts ?? [];
  const assumptions = [
    ...inferredAssumptions(planPayload),
    ...(brief?.userConstraints ?? []).map((c) => c.description).filter(Boolean),
  ];

  return (
    <div className="rounded-lg border border-surface-100 bg-surface-200/40 p-3 space-y-3 text-xs">
      <div>
        <p className="text-slate-500 uppercase tracking-wide">What you asked for</p>
        <p className="mt-1 text-slate-100 font-medium">
          {INTENT_DISPLAY_LABELS[intentId ?? ''] ?? (intentId ? humanizeIdentifier(intentId) : 'General research request')}
        </p>
        {confidence != null ? (
          <p className="text-[11px] text-slate-400 mt-1">Classifier confidence: {(confidence * 100).toFixed(0)}%</p>
        ) : null}
      </div>

      <div>
        <p className="text-slate-500 uppercase tracking-wide mb-1">Deliverables</p>
        <ResearchDeliverablesChecklist artifacts={deliverables} />
      </div>

      <div>
        <p className="text-slate-500 uppercase tracking-wide mb-1">Assumptions</p>
        <ResearchAssumptionsEditor
          assumptions={assumptions}
          disabled={disabled}
          onUseAsRefinement={onAssumptionEditsReady}
        />
      </div>

      <div>
        <p className="text-slate-500 uppercase tracking-wide">What’s not included</p>
        <p className="mt-1 text-slate-400">
          The run follows the confirmed plan only. Anything not listed in deliverables, assumptions, or refinements is out
          of scope for this run.
        </p>
      </div>
    </div>
  );
}
